// REVIEW ACTIONS — the bridge between "guests keep saying X" and "someone fixed X".
//
// GET    ?status=open&kind=clean         list the board
// POST   { op:'generate', days? }        rebuild actions from recent reviews (idempotent upsert)
// PATCH  { id, status?, note? }          tick one off
//
// THE THRESHOLD, and why it is not just "two mentions". listingIntel only tells the field about a
// theme once TWO guests have raised it, which is right for a standing note on a task — one grumble
// is not a pattern. It is wrong for an action board: a single 2-star review saying the shower ran
// cold is the most actionable thing in the building. So the rule here is TWO mentions, OR ONE
// mention inside a review rated 3 or below.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildingOf } from '@/lib/geo-areas'
import { THEMES, THEME_BY_KEY, sentenceAbout, looksNegative } from '@/lib/review-themes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// TEN DAYS, ROLLING. A six-month sweep produced a 400-row backlog nobody could work. The board is
// meant to be the live edge of guest feedback: what came in since roughly last week, and everything
// that arrives from here on. Older complaints still shape the field intel via the theme history —
// they just do not sit here pretending to be today's work.
const LOOKBACK = 10
const LOW_STAR = 3          // at or below this, one mention is enough
const HAPPY = 4.6           // above this the guest was delighted; their words are not a work order
const SINGLE_FRESH = 90     // a ONE-OFF complaint goes stale; a repeated one does not
const URGENT_PAIR = 60      // two mentions this recently is a live pattern
const URGENT_BAD = 30       // a very bad review this recently still needs answering

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const status = str(sp.get('status')) || 'live'      // live = open + doing
  const kind = str(sp.get('kind')) || 'all'
  const listingId = str(sp.get('listingId'))

  const db = supabaseAdmin()
  let q = db.from('review_actions').select('*')
  if (status === 'live') q = q.in('status', ['open', 'doing'])
  else if (status !== 'all') q = q.eq('status', status)
  if (kind !== 'all') q = q.eq('kind', kind)
  if (listingId) q = q.eq('listing_id', listingId)

  const { data, error } = await q.order('severity', { ascending: true }).order('mentions', { ascending: false }).limit(500)
  if (error) {
    // The table only exists after its migration. A missing table must read as "nothing yet", not as
    // a broken page — the rest of the reviews board has to keep working.
    if (/relation .* does not exist|schema cache/i.test(str(error.message))) {
      return NextResponse.json({ ok: true, actions: [], counts: { open: 0, doing: 0, done: 0, dismissed: 0 }, needsMigration: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: allRows } = await db.from('review_actions').select('status')
  const counts = { open: 0, doing: 0, done: 0, dismissed: 0 } as Record<string, number>
  for (const r of ((allRows || []) as any[])) counts[str(r.status)] = (counts[str(r.status)] || 0) + 1

  return NextResponse.json({ ok: true, actions: data || [], counts })
}

export async function PATCH(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: any = { updated_at: new Date().toISOString() }
  const status = str(body?.status)
  if (status) {
    if (!['open', 'doing', 'done', 'dismissed'].includes(status)) return NextResponse.json({ error: 'bad status' }, { status: 400 })
    patch.status = status
    // Stamp WHO finished it and when — a done row with no name is not an audit trail.
    patch.completed_at = (status === 'done' || status === 'dismissed') ? new Date().toISOString() : null
    patch.completed_by = (status === 'done' || status === 'dismissed') ? (access.email || access.role || 'user') : null
  }
  if (typeof body?.note === 'string') patch.note = body.note.slice(0, 600)

  const { data, error } = await supabaseAdmin().from('review_actions').update(patch).eq('id', id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, action: data })
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  if (str(body?.op) !== 'generate') return NextResponse.json({ error: 'unknown op' }, { status: 400 })

  const days = Math.min(Math.max(Number(body?.days) || LOOKBACK, 1), 730)
  const today = ymd(new Date())
  const from = addDays(today, -days)
  const db = supabaseAdmin()

  // PostgREST caps every request at 1000 rows regardless of .limit(), so this is paged.
  const reviews: any[] = []
  for (let i = 0; i < 8; i++) {
    const { data, error } = await db.from('guesty_reviews')
      .select('id,listing_id,rating,content,channel,created_at')
      .gte('created_at', from + 'T00:00:00Z')
      .order('created_at', { ascending: false })
      .range(i * 1000, i * 1000 + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data || []) as any[]
    reviews.push(...rows)
    if (rows.length < 1000) break
  }

  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building')
  const lmap: Record<string, { name: string; building: string }> = {}
  for (const l of ((lRows || []) as any[])) {
    const name = l.nickname || l.title || 'Unit'
    lmap[str(l.id)] = { name, building: buildingOf(str(l.building)) || buildingOf(name) || str(l.building) || 'Other' }
  }

  // Bucket every themed mention by unit.
  type Hit = { quote: string; at: string; rating: number; channel: string; reviewId: string }
  const bag: Record<string, Record<string, Hit[]>> = {}
  for (const r of reviews) {
    const text = str(r.content).trim()
    if (!text) continue
    const lid = str(r.listing_id)
    if (!lid) continue
    const rating = Number(r.rating)
    // A delighted guest does not generate work. This single gate is what stops "check-in was
    // seamless" on a 5-star review from becoming an inspection job.
    if (Number.isFinite(rating) && rating > HAPPY) continue
    for (const t of THEMES) {
      if (!t.re.test(text)) continue
      const quote = sentenceAbout(text, t.re)
      if (!looksNegative(quote, rating)) continue      // matched the word, but it was praise
      const perUnit = bag[lid] = bag[lid] || {}
      const arr = perUnit[t.key] = perUnit[t.key] || []
      arr.push({
        quote,
        at: str(r.created_at).slice(0, 10),
        rating: Number.isFinite(rating) ? rating : 0,
        channel: str(r.channel),
        reviewId: str(r.id),
      })
    }
  }

  // Existing rows, so we update instead of duplicating.
  const { data: existingRows, error: exErr } = await db.from('review_actions').select('*')
  if (exErr) {
    if (/relation .* does not exist|schema cache/i.test(str(exErr.message))) {
      return NextResponse.json({ error: 'The review_actions table is not in the database yet — run supabase/migrations/022_review_actions.sql.' }, { status: 503 })
    }
    return NextResponse.json({ error: exErr.message }, { status: 500 })
  }
  const existing: Record<string, any> = {}
  for (const r of ((existingRows || []) as any[])) existing[str(r.listing_id) + '|' + str(r.theme_key)] = r

  const inserts: any[] = []
  const updates: { id: string; patch: any }[] = []
  const keep = new Set<string>()      // every (unit, theme) that still justifies a job
  let reopened = 0

  for (const lid of Object.keys(bag)) {
    const li = lmap[lid]
    if (!li) continue                       // a review whose listing is gone is not actionable
    for (const key of Object.keys(bag[lid])) {
      const theme = THEME_BY_KEY[key]
      if (!theme) continue
      const hits = bag[lid][key].sort((a, b) => (a.at < b.at ? 1 : -1))
      const worst = hits.reduce((w, h) => (h.rating > 0 && (w == null || h.rating < w) ? h.rating : w), null as number | null)
      const bad = worst != null && worst <= LOW_STAR
      // Two mentions, or one inside a genuinely bad review.
      if (hits.length < 2 && !bad) continue

      const dates = hits.map(h => h.at).filter(Boolean).sort()
      const firstSeen = dates[0] || null
      const lastSeen = dates[dates.length - 1] || null
      const ageDays = lastSeen ? daysBetween(lastSeen, today) : 9999

      // A SINGLE complaint goes stale. One guest disliked the kitchen five months ago and the unit
      // has been cleaned forty times since — that is history, not a job. A REPEATED complaint stays
      // on the board for the whole window, because repetition is the evidence that it is structural.
      if (hits.length < 2 && ageDays > SINGLE_FRESH) continue
      keep.add(lid + '|' + key)

      // Urgency is RECURRENCE and RECENCY, not just a low star. In a portfolio where two-star
      // reviews are common, "worst <= 2" flagged 400 of 401 rows — a badge on everything is a badge
      // on nothing. What actually deserves jumping the queue is a pattern that is still live.
      const urgent = hits.length >= 3
        || (hits.length >= 2 && ageDays <= URGENT_PAIR)
        || (worst != null && worst <= 2 && ageDays <= URGENT_BAD)
      const evidence = hits.slice(0, 3).map(h => ({ quote: h.quote, at: h.at, rating: h.rating, channel: h.channel, reviewId: h.reviewId }))
      const row = {
        listing_id: lid,
        unit: li.name,
        building: li.building,
        theme_key: key,
        kind: theme.owner,
        title: theme.label.charAt(0).toUpperCase() + theme.label.slice(1) + ' — ' + li.name,
        action: theme.action,
        severity: urgent ? 'urgent' : 'normal',
        mentions: hits.length,
        worst_rating: worst,
        evidence,
        first_seen: firstSeen,
        last_seen: lastSeen,
        updated_at: new Date().toISOString(),
      }

      const prev = existing[lid + '|' + key]
      if (!prev) { inserts.push(row); continue }

      // THE REOPEN RULE: a complaint dated after the fix means the fix did not hold.
      const completedOn = prev.completed_at ? str(prev.completed_at).slice(0, 10) : null
      const cameBack = (prev.status === 'done' || prev.status === 'dismissed')
        && !!completedOn && !!lastSeen && lastSeen > completedOn
      const patch: any = { ...row }
      if (cameBack) {
        patch.status = 'open'
        patch.reopened_count = Number(prev.reopened_count || 0) + 1
        patch.completed_at = null
        patch.completed_by = null
        patch.severity = 'urgent'      // a fix that did not hold always jumps the queue
        reopened++
      } else {
        // Don't yank a finished row back onto the board just because we recounted old reviews.
        delete patch.severity
        patch.status = prev.status
      }
      updates.push({ id: str(prev.id), patch })
    }
  }

  let created = 0
  if (inserts.length) {
    const { error } = await db.from('review_actions').insert(inserts)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    created = inserts.length
  }
  for (const u of updates) {
    await db.from('review_actions').update(u.patch).eq('id', u.id)
  }

  // PRUNE, BUT ONLY INSIDE THE WINDOW WE ACTUALLY SCANNED.
  //
  // This run only looked at the last `days` of reviews, so it can only speak for that period. A row
  // whose evidence predates the window is not "unjustified" — it is simply outside this scan's
  // authority, and deleting it would quietly bin open work every time the board refreshed. So a row
  // is retired only when its own evidence sits inside the window and no longer qualifies.
  // Untouched OPEN rows only: anything started, finished, dismissed or annotated is someone's record.
  let pruned = 0
  const stale = ((existingRows || []) as any[]).filter(r =>
    str(r.status) === 'open' && !str(r.note).trim()
    && str(r.last_seen) >= from
    && !keep.has(str(r.listing_id) + '|' + str(r.theme_key)))
  for (let i = 0; i < stale.length; i += 100) {
    const ids = stale.slice(i, i + 100).map(r => str(r.id))
    const { error } = await db.from('review_actions').delete().in('id', ids)
    if (!error) pruned += ids.length
  }

  return NextResponse.json({ ok: true, created, updated: updates.length, reopened, pruned, scanned: reviews.length, days })
}

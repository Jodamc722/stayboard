import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// OPS SNAPSHOT FOR ONE LISTING — the evidence that goes into a Breezeway task's description.
//
// Read by the Add-a-task sheet (components/AddTaskSheet) and by the scheduler's unit panel
// (components/ListingOpsPanel). Both hand it to lib/task-brief, which is the one place that
// decides how a task description reads.
//
// ── REBUILT 2026-09-14 (Jon: "the details added to the tasks in the description should be a
// little tighter and cleaner. It feels like a lot of noise. Should share guest feedback, things
// to look for based on guest feedback, sentiment, reviews, or previous glitches.")
//
// THREE THINGS WERE WRONG.
//
//   1. GENERIC FILLER IN EVERY TASK. When a unit had no low reviews — which is most units, most
//      of the time — this returned four lines of GENERIC_CHECKS ("Walk every room", "Test A/C,
//      Wi-Fi, TV and all appliances") and the sheet pasted them into the description. A cleaner
//      who reads "walk every room" on every task stops reading task descriptions, which is
//      exactly the noise that makes the ONE task with something real in it get skimmed too.
//      Generic checks are now returned separately, flagged `generic: true`, and the composer
//      leaves them out. Nothing is better than filler.
//
//   2. NO GLITCHES. Jon asked for previous glitches by name and this route had never looked at
//      the table. A unit with an A/C glitch closed out three weeks ago is the single most useful
//      thing you can tell somebody walking into it, and it was not being told.
//
//   3. THE EVIDENCE WAS THROWN AWAY. Every low review was concatenated into one lowercased blob
//      and regex-matched, so the output was "Verify A/C cools properly" with no way to know which
//      guest said what, or when, or whether it was last week or last March. A check nobody can
//      trace is a check nobody trusts. Each focus row now carries the quote that caused it.
//
// `checklist` (string[]) is kept exactly as it was so ListingOpsPanel's rendered list is
// unaffected; `focus` is the richer shape the composer reads.

const LOW = 3
const DAYS = 180
const GLITCH_DAYS = 120

function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

const shortDay = (iso: string | null | undefined) => {
  const s = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const [y, m, dd] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const daysSince = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 864e5)) : null
}

// A SHORT QUOTE, ENDING ON A WORD. A hard .slice() mid-word reads as corrupted text in the field
// app; trimming back to the last space and adding an ellipsis reads as an excerpt.
function snippet(s: string, max: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…'
}

// The phrase that earned the check, so the crew reads the guest's words and not ours.
const CHECK_MAP: { keys: string[]; item: string }[] = [
  { keys: ['clean', 'dirty', 'dust', 'hair', 'stain', 'sticky', 'grime'], item: 'Cleanliness — floors, surfaces, bathroom, kitchen, linens' },
  { keys: ['ac ', 'a/c', 'air condition', 'too hot', 'too cold', 'temperature', 'thermostat'], item: 'A/C — does it actually cool; filter and thermostat' },
  { keys: ['smell', 'odor', 'odour', 'musty', 'mold', 'mildew'], item: 'Odors — trash, drains, fridge, HVAC, damp areas' },
  { keys: ['noise', 'loud', 'noisy'], item: 'Noise — appliances, HVAC, doors' },
  { keys: ['broke', 'broken', 'leak', 'repair', 'maintenance', 'not work', 'malfunction'], item: 'Maintenance — plumbing, fixtures, electronics, locks' },
  { keys: ['towel', 'sheet', 'linen', 'amenit', 'soap', 'shampoo', 'coffee', 'supplies', 'restock'], item: 'Supplies — linens, towels, toiletries, coffee, paper goods' },
  { keys: ['wifi', 'wi-fi', 'internet', 'tv ', 'remote', 'streaming'], item: 'Wi-Fi and TV — speed test, streaming logins' },
  { keys: ['key', 'lock', 'code', 'access', 'door', 'fob', 'entry'], item: 'Entry — door code, lock, key fob, building access' },
  { keys: ['bug', 'pest', 'roach', 'ant ', 'insect'], item: 'Pests — kitchen, bathroom, baseboards (flag an exterminator if seen)' },
  { keys: ['parking', 'garage'], item: 'Parking / garage access instructions still accurate' },
]

const GENERIC_CHECKS = [
  'Walk every room: cleanliness, damage, missing items',
  'Test A/C, Wi-Fi, TV, and all appliances',
  'Restock linens, towels, and toiletries',
  'Confirm entry codes and building access work',
]

export type FocusRow = {
  item: string
  because: string          // the guest's words, or the glitch overview
  source: 'review' | 'glitch'
  when: string             // "Aug 14"
  rating?: number | null
}

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user

  const url = new URL(req.url)
  const listingId = String(url.searchParams.get('listingId') || '').trim()
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const db = supabaseAdmin()
  const since = daysAgoISO(DAYS)
  const [{ data: reviews }, { data: qcs }, { data: listing }, { data: glitchRows }] = await Promise.all([
    db.from('guesty_reviews').select('rating,content,guest_name,created_at').eq('listing_id', listingId).order('created_at', { ascending: false }).limit(40),
    db.from('qc_tasks').select('breezeway_task_id,report_url,issue_type,status,department,created_at').eq('listing_id', listingId).eq('status', 'open'),
    db.from('guesty_listings').select('nickname,title').eq('id', listingId).limit(1).maybeSingle(),
    // PREVIOUS GLITCHES (new). Open ones first — an unresolved glitch is a live instruction — but
    // recently-closed ones matter too: "the A/C was fixed three weeks ago" is why you check it.
    db.from('glitches')
      .select('id,status,glitch_type,category,overview,created_at')
      .eq('listing_id', listingId)
      .gte('created_at', daysAgoISO(GLITCH_DAYS))
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const revs = (reviews || []) as any[]
  const lastReview = revs[0] || null
  const recentLow = revs.filter((r) => Number(r.rating) > 0 && Number(r.rating) <= LOW && String(r.created_at || '') >= since)
  const openTasks = (qcs || []) as any[]
  const openInspection =
    openTasks.find((q) => String(q.department || q.issue_type || '').toLowerCase().includes('inspect')) || openTasks[0] || null

  const CLOSED = ['done', 'resolved', 'closed']
  const glitches = (glitchRows || []) as any[]
  const openGlitches = glitches.filter(g => CLOSED.indexOf(String(g.status || '').toLowerCase()) < 0)
  const closedGlitches = glitches.filter(g => CLOSED.indexOf(String(g.status || '').toLowerCase()) >= 0)

  const reasons: string[] = []
  if (recentLow.length) reasons.push(recentLow.length + ' low review' + (recentLow.length > 1 ? 's' : '') + ' in the last ' + DAYS + ' days')
  if (openGlitches.length) reasons.push(openGlitches.length + ' open glitch' + (openGlitches.length > 1 ? 'es' : ''))
  if (closedGlitches.length) reasons.push(closedGlitches.length + ' glitch' + (closedGlitches.length > 1 ? 'es' : '') + ' fixed in the last ' + GLITCH_DAYS + ' days')
  if (openTasks.length) reasons.push(openTasks.length + ' open QC/inspection task' + (openTasks.length > 1 ? 's' : ''))
  const recommended = recentLow.length > 0 || openGlitches.length > 0 || openTasks.length > 0

  // ── FOCUS: one row per thing to look at, each carrying the evidence that put it there ─────────
  // Matched review by review rather than against one concatenated blob, so the quote, the date and
  // the star rating survive to the description. First match per check wins — the newest review is
  // first in the list, so the most recent complaint is the one quoted.
  const focus: FocusRow[] = []
  const taken = new Set<string>()
  for (const r of recentLow) {
    const text = String(r.content || '')
    const hay = ' ' + text.toLowerCase() + ' '
    for (const m of CHECK_MAP) {
      if (taken.has(m.item)) continue
      if (!m.keys.some((k) => new RegExp('\\b' + k.trim()).test(hay))) continue
      taken.add(m.item)
      focus.push({ item: m.item, because: snippet(text, 120), source: 'review', when: shortDay(r.created_at), rating: r.rating ?? null })
    }
  }
  // Glitches earn their own rows — an open one is a live instruction, a recent fix is a re-check.
  for (const g of openGlitches.slice(0, 4)) {
    const what = String(g.glitch_type || g.category || 'Reported issue')
    const age = daysSince(g.created_at)
    focus.push({
      item: what + (age != null ? ' — still open, ' + age + (age === 1 ? ' day' : ' days') : ' — still open'),
      because: snippet(String(g.overview || ''), 120), source: 'glitch', when: shortDay(g.created_at),
    })
  }
  for (const g of closedGlitches.slice(0, 2)) {
    const what = String(g.glitch_type || g.category || 'Previous issue')
    focus.push({
      item: what + ' — fixed ' + (shortDay(g.created_at) || 'recently') + ', confirm it held',
      because: snippet(String(g.overview || ''), 120), source: 'glitch', when: shortDay(g.created_at),
    })
  }

  // Kept as string[] for components/ListingOpsPanel, which renders it as a plain list.
  const checklist: string[] = focus.length ? focus.map(f => f.item) : GENERIC_CHECKS.slice()

  const lastFeedback = lastReview
    ? {
        rating: lastReview.rating ?? null,
        guest: lastReview.guest_name || null,
        date: String(lastReview.created_at || '').slice(0, 10),
        excerpt: String(lastReview.content || '').slice(0, 300),
      }
    : null

  return NextResponse.json({
    listingId,
    unit: listing?.nickname || listing?.title || 'Unit',
    inspection: { recommended, reasons },
    lastFeedback,
    checklist,
    // TRUE when `checklist` is the generic fallback and carries no information about THIS unit.
    // lib/task-brief drops it on the floor; the scheduler panel still shows it, because there a
    // human is choosing to look and a starting list beats an empty box.
    generic: focus.length === 0,
    focus,
    history: {
      lowReviews: recentLow.length,
      reviewWindowDays: DAYS,
      openGlitches: openGlitches.length,
      fixedGlitches: closedGlitches.length,
      glitchWindowDays: GLITCH_DAYS,
      lastGlitch: glitches[0]
        ? { type: String(glitches[0].glitch_type || glitches[0].category || 'Issue'), when: shortDay(glitches[0].created_at), open: CLOSED.indexOf(String(glitches[0].status || '').toLowerCase()) < 0 }
        : null,
    },
    openInspection: openInspection
      ? { taskId: String(openInspection.breezeway_task_id || ''), reportUrl: openInspection.report_url || null }
      : null,
  })
}

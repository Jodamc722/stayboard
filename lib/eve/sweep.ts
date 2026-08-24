// The nightly learning sweep — how Eve actually learns the business rather than re-deriving it.
//
// WHAT THIS REPLACES. /api/eve/learn mined exactly three sources (guest messages, reviews, sentiment
// top_issues) into FAQs and complaint categories. Useful, but it only ever looked at the guest-facing
// surface, so Eve started every operational and financial conversation from zero.
//
// THE SHAPE. Eight miners, one per domain. Each is DETERMINISTIC — it counts, groups and ranks real
// records. No model call decides what is true here; the model is only used at the end to phrase what
// the counting found. That matters: a hallucinated "insight" that lands in memory gets quoted back
// as fact for months.
//
// WHAT GETS WRITTEN:
//   eve_knowledge — everything, as browsable reference.
//   eve_memory    — only findings that clear a confidence bar, so the prompt stays sharp. A memory
//                   is expensive (it costs prompt space on EVERY turn); knowledge is cheap.
//
// IDEMPOTENT BY CONSTRUCTION. Every row has a stable djb2 id, so re-running updates in place rather
// than accumulating duplicates. Safe to run hourly if it ever needs to be.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'
import { isDepartureCleanName } from '@/lib/breezeway'
import { todayET, shiftDay, lc, num, round2, normStar, safe, DEAD_LISTING } from './ctx'
import { saveMemory } from './memory'

export function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) + s.charCodeAt(i)) >>> 0
  return String(h)
}

export type Finding = {
  id: string
  type: 'faq' | 'complaint' | 'insight' | 'fact'
  scope: string
  title: string
  content: string
  evidence_count: number
  /** promote to eve_memory when true — reserved for things worth prompt space every single turn */
  promote?: boolean
  memoryKind?: string
  weight?: number
}

type Ctx = {
  db: ReturnType<typeof supabaseAdmin>
  days: number
  from: string
  today: string
  listing: Record<string, { name: string; building: string; active: boolean }>
}

async function buildCtx(days: number): Promise<Ctx> {
  const db = supabaseAdmin()
  const today = todayET()
  const listing: Record<string, { name: string; building: string; active: boolean }> = {}
  const { data } = await db.from('guesty_listings').select('id,nickname,title,status,building').order('id')
  for (const l of (data || [])) {
    const r: any = l
    listing[String(r.id)] = {
      name: r.nickname || r.title || '',
      building: rollupBuilding(r.building, r.nickname || r.title),
      active: !DEAD_LISTING.test(lc(r.status)),
    }
  }
  return { db, days, from: shiftDay(today, -days), today, listing }
}

const bOf = (c: Ctx, id: any) => c.listing[String(id)]?.building || 'Unassigned'
const nOf = (c: Ctx, id: any) => c.listing[String(id)]?.name || 'Unknown unit'

// ---------------------------------------------------------------------------------------------
// 1. OPS — which units and buildings keep generating work, and what kind.
// ---------------------------------------------------------------------------------------------
async function mineOps(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const res: any = await safe(c.db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,assignees,finished_at,total_minutes,type_department')
    .gte('scheduled_date', c.from).order('id').limit(6000), { data: [] } as any)
  const tasks = res.data || []
  if (!tasks.length) return out

  // Units that repeatedly need unplanned work (a repeat visit is a symptom, not a task).
  const byUnit: Record<string, { n: number; maint: number; name: string; building: string }> = {}
  const cleanMins: Record<string, number[]> = {}
  for (const t of tasks) {
    const k = String(t.reference_property_id || '')
    if (!k) continue
    if (!byUnit[k]) byUnit[k] = { n: 0, maint: 0, name: nOf(c, k), building: bOf(c, k) }
    byUnit[k].n++
    if (lc(t.type_department) === 'maintenance') byUnit[k].maint++
    if (isDepartureCleanName(t.name) && num(t.total_minutes) > 0 && t.finished_at) {
      (cleanMins[bOf(c, k)] = cleanMins[bOf(c, k)] || []).push(num(t.total_minutes))
    }
  }
  const heavy = Object.keys(byUnit).map(k => byUnit[k]).filter(u => u.maint >= 4)
    .sort((a, b) => b.maint - a.maint).slice(0, 10)
  for (const u of heavy) {
    out.push({
      id: 'ops_maint_' + djb2(u.name), type: 'insight', scope: 'building:' + u.building,
      title: `${u.name} needs repeated maintenance`,
      content: `${u.maint} maintenance tasks in the last ${c.days} days (${u.n} tasks total). A unit needing this much unplanned work usually has one underlying fault, not many small ones — worth a full walk rather than another ticket.`,
      evidence_count: u.maint,
      promote: u.maint >= 8, memoryKind: 'issue', weight: 6,
    })
  }

  // How long a clean actually takes, per building — the number every schedule assumption rests on.
  const buildings = Object.keys(cleanMins)
  for (const b of buildings) {
    const arr = cleanMins[b].slice().sort((x, y) => x - y)
    if (arr.length < 8) continue
    const med = arr[Math.floor(arr.length / 2)]
    const p90 = arr[Math.floor(arr.length * 0.9)]
    out.push({
      id: 'ops_cleantime_' + djb2(b), type: 'fact', scope: 'building:' + b,
      title: `${b}: a departure clean really takes ~${Math.round(med)} min`,
      content: `Median ${Math.round(med)} minutes across ${arr.length} completed departure cleans in ${c.days} days; the slow tail (90th percentile) is ${Math.round(p90)} minutes. Use these when judging whether a clean is genuinely running long.`,
      evidence_count: arr.length,
      promote: true, memoryKind: 'insight', weight: 5,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 2. QUALITY — recurring themes, and the strongest structural signal we have: reopened actions.
// ---------------------------------------------------------------------------------------------
async function mineQuality(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const ra: any = await safe(c.db.from('review_actions')
    .select('theme_key,kind,unit,building,mentions,worst_rating,status,reopened_count,last_seen')
    .order('reopened_count', { ascending: false }).limit(300), { data: [] } as any)
  const rows = ra.data || []
  const repeats = rows.filter((r: any) => (r.reopened_count || 0) > 0)
  for (const r of repeats.slice(0, 12)) {
    out.push({
      id: 'q_reopen_' + djb2(String(r.unit) + r.theme_key), type: 'insight',
      scope: 'building:' + (r.building || 'Unassigned'),
      title: `${r.unit}: "${r.theme_key}" keeps coming back`,
      content: `Marked done and reopened ${r.reopened_count}x, ${r.mentions} guest mentions, worst rating ${normStar(r.worst_rating) ?? '?'}/5. A theme that reopens is a structural problem — the fix that was applied did not hold. Do not just re-close it.`,
      evidence_count: (r.reopened_count || 0) + (r.mentions || 0),
      promote: true, memoryKind: 'issue', weight: 7,
    })
  }

  // Building-level review standing, so she knows what "normal" looks like per building.
  const rv: any = await safe(c.db.from('guesty_reviews').select('listing_id,rating,has_reply,excluded_from_score,created_at')
    .gte('created_at', c.from).eq('excluded_from_score', false).order('id').limit(4000), { data: [] } as any)
  const byB: Record<string, { n: number; sum: number; low: number; unanswered: number }> = {}
  for (const r of (rv.data || [])) {
    const stars = normStar((r as any).rating)
    if (stars == null) continue
    const b = bOf(c, (r as any).listing_id)
    if (!byB[b]) byB[b] = { n: 0, sum: 0, low: 0, unanswered: 0 }
    byB[b].n++; byB[b].sum += stars
    if (stars <= 3) byB[b].low++
    if (!(r as any).has_reply) byB[b].unanswered++
  }
  const bs = Object.keys(byB)
  for (const b of bs) {
    const v = byB[b]
    if (v.n < 10) continue
    const avg = round2(v.sum / v.n)
    out.push({
      id: 'q_bldg_' + djb2(b), type: 'fact', scope: 'building:' + b,
      title: `${b} runs at ${avg}/5`,
      content: `${v.n} scored reviews in ${c.days} days, average ${avg}/5, ${v.low} at 3 stars or below, ${v.unanswered} still unanswered. This is ${b}'s normal — judge new reviews against it, not against the portfolio.`,
      evidence_count: v.n,
      promote: v.n >= 25, memoryKind: 'insight', weight: 5,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 3. GUEST COMMS — the customer-service layer. Response behaviour and what guests actually ask.
// ---------------------------------------------------------------------------------------------
async function mineGuestComms(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const st: any = await safe(c.db.from('guesty_conversation_sentiment')
    .select('listing_id,score,band,dissatisfied,top_issue,awaiting_reply,last_message_at,last_guest_at')
    .gte('last_message_at', c.from).order('conversation_id').limit(2000), { data: [] } as any)
  const rows = st.data || []
  if (rows.length) {
    const issues: Record<string, number> = {}
    let dissatisfied = 0, awaiting = 0
    for (const r of rows) {
      if (r.dissatisfied) dissatisfied++
      if (r.awaiting_reply) awaiting++
      const k = lc(r.top_issue).slice(0, 40)
      if (k) issues[k] = (issues[k] || 0) + 1
    }
    const top = Object.keys(issues).map(k => ({ k, n: issues[k] })).sort((a, b) => b.n - a.n).slice(0, 8)
    for (const t of top) {
      if (t.n < 3) continue
      out.push({
        id: 'gc_issue_' + djb2(t.k), type: 'complaint', scope: 'portfolio',
        title: t.k, content: `Raised in ${t.n} guest threads over ${c.days} days. Pre-empting this in the guide or the check-in message is cheaper than answering it ${t.n} more times.`,
        evidence_count: t.n, promote: t.n >= 8, memoryKind: 'issue', weight: 6,
      })
    }
    out.push({
      id: 'gc_health', type: 'fact', scope: 'portfolio',
      title: 'Guest-comms baseline',
      content: `Over ${c.days} days: ${rows.length} scored threads, ${dissatisfied} flagged unhappy (${Math.round((dissatisfied / rows.length) * 100)}%), ${awaiting} still awaiting our reply. Use these as the normal rate when judging a spike.`,
      evidence_count: rows.length, promote: true, memoryKind: 'insight', weight: 5,
    })
  }

  // FRESHNESS IS PART OF THE ANSWER. If the message feed is stale, everything above is stale too,
  // and Eve must know that rather than quoting old threads as current.
  const fs: any = await safe(c.db.from('guesty_sync_status').select('entity,last_sync_at,last_error')
    .in('entity', ['messages', 'conversations']), { data: [] } as any)
  for (const f of (fs.data || [])) {
    const age = (f as any).last_sync_at ? Math.round((Date.now() - new Date((f as any).last_sync_at).getTime()) / 60000) : null
    if (age != null && age > 180) {
      out.push({
        id: 'gc_stale_' + djb2(String((f as any).entity)), type: 'fact', scope: 'portfolio',
        title: `The ${(f as any).entity} feed is ${age} minutes stale`,
        content: `Last successful sync ${age} minutes ago${(f as any).last_error ? ` (last error: ${(f as any).last_error})` : ''}. Any answer about guest messages is only as fresh as this — say so rather than presenting old threads as current.`,
        evidence_count: 1, promote: true, memoryKind: 'issue', weight: 8,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 4. MONEY — owner-statement audit patterns. Which flags keep firing, and on whom.
// ---------------------------------------------------------------------------------------------
async function mineMoney(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const ar: any = await safe(c.db.from('owner_audit_reviews').select('month,owner_id,item_key,status,note')
    .order('month', { ascending: false }).limit(1000), { data: [] } as any)
  const rows = ar.data || []
  if (rows.length) {
    const byStatus: Record<string, number> = {}
    for (const r of rows) byStatus[String(r.status)] = (byStatus[String(r.status)] || 0) + 1
    out.push({
      id: 'money_audit_state', type: 'fact', scope: 'portfolio',
      title: 'Owner-statement audit standing',
      content: `${rows.length} statement line reviews on file: ${Object.keys(byStatus).map(k => `${byStatus[k]} ${k}`).join(', ')}. Anything still in "review" is unresolved money.`,
      evidence_count: rows.length, promote: true, memoryKind: 'insight', weight: 6,
    })
  }
  // Statement coverage — a month with earnings but no statement is how money goes missing.
  const lm: any = await safe(c.db.from('guesty_ledger_months').select('month,status,rows_synced,last_error')
    .order('month', { ascending: false }).limit(18), { data: [] } as any)
  const months = lm.data || []
  const bad = months.filter((m: any) => m.status !== 'done')
  if (bad.length) {
    out.push({
      id: 'money_ledger_gaps', type: 'insight', scope: 'portfolio',
      title: `${bad.length} ledger month(s) are not fully synced`,
      content: `Months not in a done state: ${bad.map((m: any) => `${m.month} (${m.status})`).join(', ')}. Any owner-earnings figure covering these months is incomplete — say so before quoting one.`,
      evidence_count: bad.length, promote: true, memoryKind: 'rule', weight: 8,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 5. PEOPLE — the Homebase/Breezeway name map she keeps re-deriving from scratch every session.
// ---------------------------------------------------------------------------------------------
async function minePeople(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const res: any = await safe(c.db.from('breezeway_tasks_sync').select('assignees,type_department,name,finished_at')
    .gte('scheduled_date', c.from).order('id').limit(5000), { data: [] } as any)
  const byPerson: Record<string, { cleans: number; tasks: number }> = {}
  for (const t of (res.data || [])) {
    const list = Array.isArray((t as any).assignees) ? (t as any).assignees : []
    for (const a of list) {
      const nm = String(a?.name || '').trim()
      if (!nm) continue
      if (!byPerson[nm]) byPerson[nm] = { cleans: 0, tasks: 0 }
      byPerson[nm].tasks++
      if (isDepartureCleanName((t as any).name)) byPerson[nm].cleans++
    }
  }
  const people = Object.keys(byPerson).map(k => ({ name: k, ...byPerson[k] })).sort((a, b) => b.tasks - a.tasks).slice(0, 25)
  if (people.length) {
    out.push({
      id: 'people_roster', type: 'fact', scope: 'portfolio',
      title: 'Who is actually doing the work',
      content: `Over ${c.days} days, by Breezeway assignment: ${people.slice(0, 12).map(p => `${p.name} (${p.tasks} tasks, ${p.cleans} cleans)`).join('; ')}. These are the Breezeway spellings — Homebase spells several of them differently.`,
      evidence_count: people.length, promote: true, memoryKind: 'person', weight: 6,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 6. PORTFOLIO — the shape of the business. She should never have to look this up.
// ---------------------------------------------------------------------------------------------
async function minePortfolio(c: Ctx): Promise<Finding[]> {
  const ids = Object.keys(c.listing)
  const active = ids.filter(i => c.listing[i].active)
  const byB: Record<string, number> = {}
  for (const i of active) byB[c.listing[i].building] = (byB[c.listing[i].building] || 0) + 1
  const list = Object.keys(byB).map(b => ({ b, n: byB[b] })).sort((a, b) => b.n - a.n)
  return [{
    id: 'portfolio_shape', type: 'fact', scope: 'portfolio',
    title: `${active.length} active units across ${list.length} buildings`,
    content: `${list.map(x => `${x.b} ${x.n}`).join(', ')}. (${ids.length - active.length} inactive listings excluded.)`,
    evidence_count: active.length, promote: true, memoryKind: 'insight', weight: 7,
  }]
}

// ---------------------------------------------------------------------------------------------
// 7. GUEST ISSUES — what actually goes wrong, and where.
// ---------------------------------------------------------------------------------------------
async function mineIssues(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const g: any = await safe(c.db.from('glitches').select('listing_id,unit,category,glitch_type,status,created_at')
    .gte('created_at', c.from + 'T00:00:00Z').order('id').limit(2000), { data: [] } as any)
  const rows = g.data || []
  if (!rows.length) return out
  const byCat: Record<string, number> = {}
  const byBld: Record<string, number> = {}
  for (const r of rows) {
    const cat = String(r.category || 'uncategorised')
    byCat[cat] = (byCat[cat] || 0) + 1
    const b = bOf(c, r.listing_id)
    byBld[b] = (byBld[b] || 0) + 1
  }
  const cats = Object.keys(byCat).map(k => ({ k, n: byCat[k] })).sort((a, b) => b.n - a.n).slice(0, 6)
  out.push({
    id: 'issues_mix', type: 'insight', scope: 'portfolio',
    title: 'What actually goes wrong',
    content: `${rows.length} guest issues in ${c.days} days. By category: ${cats.map(x => `${x.k} ${x.n}`).join(', ')}. By building: ${Object.keys(byBld).map(b => `${b} ${byBld[b]}`).sort().join(', ')}.`,
    evidence_count: rows.length, promote: true, memoryKind: 'insight', weight: 6,
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// 8. SELF-CRITIQUE — where Eve fell short yesterday. The loop that actually improves her.
// ---------------------------------------------------------------------------------------------
async function mineSelf(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const ch: any = await safe(c.db.from('eve_chats').select('id,question,answer,tools_used,turns,rating,correction,created_at')
    .gte('created_at', shiftDay(c.today, -7) + 'T00:00:00Z').eq('reviewed', false)
    .order('created_at', { ascending: false }).limit(200), { data: [] } as any)
  const rows = ch.data || []
  if (!rows.length) return out

  const thumbsDown = rows.filter((r: any) => r.rating === -1)
  const noAccess = rows.filter((r: any) => /do not have|don't have|no access|not synced|cannot see/i.test(String(r.answer || '')))
  const longRuns = rows.filter((r: any) => (r.turns || 0) >= 9)

  if (thumbsDown.length) {
    out.push({
      id: 'self_thumbsdown_' + djb2(c.today), type: 'insight', scope: 'portfolio',
      title: `${thumbsDown.length} answer(s) marked wrong this week`,
      content: thumbsDown.slice(0, 5).map((r: any) => `Q: ${String(r.question || '').slice(0, 120)} — correction: ${String(r.correction || '(none given)').slice(0, 160)}`).join(' | '),
      evidence_count: thumbsDown.length, promote: false,
    })
  }
  if (noAccess.length >= 3) {
    out.push({
      id: 'self_gaps_' + djb2(c.today), type: 'insight', scope: 'portfolio',
      title: `Answered "I can't see that" ${noAccess.length} times this week`,
      content: `Questions where a data gap blocked a real answer: ${noAccess.slice(0, 5).map((r: any) => String(r.question || '').slice(0, 100)).join(' | ')}. These are the next things worth wiring up.`,
      evidence_count: noAccess.length, promote: false,
    })
  }
  if (longRuns.length >= 3) {
    out.push({
      id: 'self_slow_' + djb2(c.today), type: 'insight', scope: 'portfolio',
      title: `${longRuns.length} question(s) took 9+ tool turns`,
      content: `Long chains usually mean a missing purpose-built tool: ${longRuns.slice(0, 4).map((r: any) => String(r.question || '').slice(0, 90)).join(' | ')}.`,
      evidence_count: longRuns.length, promote: false,
    })
  }

  // Mark them seen so the same week is not re-mined every night.
  try {
    const ids = rows.map((r: any) => r.id)
    for (let i = 0; i < ids.length; i += 200) {
      await c.db.from('eve_chats').update({ reviewed: true }).in('id', ids.slice(i, i + 200))
    }
  } catch { /* best effort */ }
  return out
}


// ---------------------------------------------------------------------------------------------
// 9. TASK COMPLETION — do we finish what we start, and who actually closes things out.
//    Jon named this one directly: "task completions here in app".
// ---------------------------------------------------------------------------------------------
async function mineCompletion(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const res: any = await safe(c.db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,assignees,finished_at,started_at,total_minutes,type_department')
    .gte('scheduled_date', c.from).lte('scheduled_date', c.today)
    .order('id').limit(6000), { data: [] } as any)
  const tasks = (res.data || []).filter((t: any) => !/delete|cancel/.test(lc(t.status)))
  if (tasks.length < 20) return out

  const done = (t: any) => !!t.finished_at || /complete|finish|close|approv/.test(lc(t.status))
  const byDept: Record<string, { n: number; done: number; late: number }> = {}
  const byPerson: Record<string, { n: number; done: number }> = {}
  let neverStarted = 0

  for (const t of tasks) {
    const d = String(t.type_department || 'other')
    if (!byDept[d]) byDept[d] = { n: 0, done: 0, late: 0 }
    byDept[d].n++
    if (done(t)) {
      byDept[d].done++
      // Finished on a later calendar day than it was scheduled = it slipped.
      const fin = String(t.finished_at || '').slice(0, 10)
      if (fin && fin > String(t.scheduled_date).slice(0, 10)) byDept[d].late++
    } else if (String(t.scheduled_date).slice(0, 10) < c.today && !t.started_at) {
      neverStarted++
    }
    const list = Array.isArray(t.assignees) ? t.assignees : []
    for (const a of list) {
      const nm = String(a?.name || '').trim()
      if (!nm) continue
      if (!byPerson[nm]) byPerson[nm] = { n: 0, done: 0 }
      byPerson[nm].n++
      if (done(t)) byPerson[nm].done++
    }
  }

  const depts = Object.keys(byDept).map(d => ({
    dept: d, tasks: byDept[d].n,
    completion_pct: Math.round((byDept[d].done / byDept[d].n) * 100),
    slipped_a_day_or_more: byDept[d].late,
  })).sort((a, b) => a.completion_pct - b.completion_pct)

  out.push({
    id: 'completion_by_dept', type: 'fact', scope: 'portfolio',
    title: 'Task completion, by department',
    content: depts.map(d => `${d.dept}: ${d.completion_pct}% of ${d.tasks} (${d.slipped_a_day_or_more} finished late)`).join(' · ')
      + `. ${neverStarted} past-dated task(s) were never even started.`,
    evidence_count: tasks.length, promote: true, memoryKind: 'insight', weight: 6,
  })

  // Only name people with a real sample — a 0/1 record is not a pattern, it is one bad afternoon.
  const laggards = Object.keys(byPerson).map(k => ({ name: k, ...byPerson[k], pct: Math.round((byPerson[k].done / byPerson[k].n) * 100) }))
    .filter(p => p.n >= 8).sort((a, b) => a.pct - b.pct).slice(0, 5)
  if (laggards.length && laggards[0].pct < 70) {
    out.push({
      id: 'completion_people', type: 'insight', scope: 'portfolio',
      title: 'Completion rate varies a lot by person',
      content: laggards.map(p => `${p.name} ${p.pct}% of ${p.n}`).join(' · ')
        + '. Low completion is usually a routing or workload problem before it is an effort problem — check what they were given before drawing a conclusion about them.',
      evidence_count: laggards.reduce((a, b) => a + b.n, 0), promote: false,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 10. REVIEW RESPONSES — are we actually replying, and how fast.
//     Jon named this one too: "reviews responses".
// ---------------------------------------------------------------------------------------------
async function mineReviewResponses(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const res: any = await safe(c.db.from('guesty_reviews')
    .select('id,listing_id,rating,has_reply,created_at,excluded_from_score,channel')
    .gte('created_at', c.from + 'T00:00:00Z').eq('excluded_from_score', false)
    .order('id').limit(4000), { data: [] } as any)
  const rows = res.data || []
  if (rows.length < 10) return out

  const byBuilding: Record<string, { n: number; replied: number; lowUnanswered: number }> = {}
  const byChannel: Record<string, { n: number; replied: number }> = {}
  for (const r of rows) {
    const b = bOf(c, r.listing_id)
    if (!byBuilding[b]) byBuilding[b] = { n: 0, replied: 0, lowUnanswered: 0 }
    byBuilding[b].n++
    if (r.has_reply) byBuilding[b].replied++
    const stars = normStar(r.rating)
    if (!r.has_reply && stars != null && stars <= 3) byBuilding[b].lowUnanswered++
    const ch = String(r.channel || 'unknown')
    if (!byChannel[ch]) byChannel[ch] = { n: 0, replied: 0 }
    byChannel[ch].n++
    if (r.has_reply) byChannel[ch].replied++
  }
  const total = rows.length
  const replied = rows.filter((r: any) => r.has_reply).length
  const lowUnanswered = rows.filter((r: any) => { const st = normStar(r.rating); return !r.has_reply && st != null && st <= 3 }).length

  out.push({
    id: 'review_response_rate', type: 'fact', scope: 'portfolio',
    title: `We reply to ${Math.round((replied / total) * 100)}% of reviews`,
    content: `${replied} of ${total} in ${c.days} days. By channel: ${Object.keys(byChannel).map(k => `${k} ${Math.round((byChannel[k].replied / byChannel[k].n) * 100)}%`).join(', ')}. `
      + `**${lowUnanswered} review(s) at 3 stars or below have no reply** — those are the ones future guests read.`,
    evidence_count: total, promote: true, memoryKind: 'insight', weight: 7,
  })

  const worst = Object.keys(byBuilding).map(b => ({ b, ...byBuilding[b], pct: Math.round((byBuilding[b].replied / byBuilding[b].n) * 100) }))
    .filter(x => x.n >= 5).sort((a, b) => a.pct - b.pct).slice(0, 4)
  for (const w of worst) {
    if (w.pct >= 80 && w.lowUnanswered === 0) continue
    out.push({
      id: 'review_resp_' + djb2(w.b), type: 'insight', scope: 'building:' + w.b,
      title: `${w.b}: ${w.pct}% of reviews answered`,
      content: `${w.replied} of ${w.n} answered in ${c.days} days` + (w.lowUnanswered ? `, and ${w.lowUnanswered} negative review(s) are sitting unanswered.` : '.')
        + ' An unanswered bad review costs more than the stay it describes — it is the last thing a prospect reads.',
      evidence_count: w.n, promote: w.lowUnanswered > 0, memoryKind: 'issue', weight: 6,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 11. GUESTY FIELD COVERAGE — what we claim to track vs what is actually filled in.
//     "custom feilds, how to find info on guesty" — the answer is usually "the field exists, it is
//     just empty", and that is worth knowing without asking.
// ---------------------------------------------------------------------------------------------
async function mineGuestyFields(c: Ctx): Promise<Finding[]> {
  const out: Finding[] = []
  const { data: ls } = await c.db.from('guesty_listings').select('id,status,raw').order('id').limit(400)
  const live = (ls || []).filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
  if (!live.length) return out
  // Resolve ids to human names. The mirror stores fieldId as a BARE STRING on most listings, so
  // without this map every field reads as a hex id and the finding is useless to a person.
  const nameById: Record<string, string> = {}
  try {
    const { data: defs } = await c.db.from('guesty_custom_fields').select('id, name').limit(500)
    for (const d of (defs || [])) nameById[String((d as any).id)] = String((d as any).name || '')
  } catch { /* degrade to ids */ }

  const fill: Record<string, number> = {}
  for (const l of live) {
    const cf = Array.isArray((l as any).raw?.customFields) ? (l as any).raw.customFields : []
    for (const cff of cf) {
      const fid = String(cff?.fieldId?._id || cff?.fieldId?.id || cff?.fieldId || '')
      const nm = String(cff?.fieldId?.name || cff?.name || nameById[fid] || fid || '').trim()
      if (!nm) continue
      const v = cff?.value
      if (v != null && String(v).trim() !== '') fill[nm] = (fill[nm] || 0) + 1
    }
  }
  const keys = Object.keys(fill)
  if (!keys.length) return out
  const ranked = keys.map(k => ({ k, n: fill[k], pct: Math.round((fill[k] / live.length) * 100) })).sort((a, b) => b.n - a.n)
  const thin = ranked.filter(r => r.pct > 0 && r.pct < 60)
  out.push({
    id: 'guesty_field_coverage', type: 'fact', scope: 'portfolio',
    title: 'Which Guesty fields are actually filled in',
    content: `Across ${live.length} active units — well covered: ${ranked.filter(r => r.pct >= 60).slice(0, 10).map(r => `${r.k} ${r.pct}%`).join(', ') || 'none'}. `
      + (thin.length ? `PATCHY (exists but mostly empty): ${thin.slice(0, 10).map(r => `${r.k} ${r.pct}%`).join(', ')}. ` : '')
      + 'When someone says we do not track something, check here first — usually the field exists and is simply blank.',
    evidence_count: live.length, promote: true, memoryKind: 'insight', weight: 6,
  })
  return out
}

// ---------------------------------------------------------------------------------------------
export const MINERS = [
  { key: 'portfolio', run: minePortfolio },
  { key: 'ops', run: mineOps },
  { key: 'quality', run: mineQuality },
  { key: 'guest_comms', run: mineGuestComms },
  { key: 'money', run: mineMoney },
  { key: 'people', run: minePeople },
  { key: 'issues', run: mineIssues },
  { key: 'completion', run: mineCompletion },
  { key: 'review_responses', run: mineReviewResponses },
  { key: 'guesty_fields', run: mineGuestyFields },
  { key: 'self', run: mineSelf },
]

export async function runSweep(days = 45): Promise<any> {
  const c = await buildCtx(Math.min(Math.max(days, 7), 180))
  const per: Record<string, number> = {}
  const all: Finding[] = []
  const errors: string[] = []
  for (const m of MINERS) {
    try {
      const found = await m.run(c)
      per[m.key] = found.length
      all.push(...found)
    } catch (e: any) {
      per[m.key] = -1
      errors.push(`${m.key}: ${String(e?.message || e).slice(0, 160)}`)
    }
  }

  // Write knowledge (cheap, browsable).
  let written = 0
  const rows = all.map(f => ({
    id: f.id, type: f.type, scope: f.scope, title: f.title.slice(0, 200),
    content: f.content.slice(0, 1200), evidence_count: Math.max(1, f.evidence_count),
    updated_at: new Date().toISOString(),
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await c.db.from('eve_knowledge').upsert(rows.slice(i, i + 200), { onConflict: 'id' })
    if (error) { errors.push('eve_knowledge: ' + error.message.slice(0, 160)); break }
    written += Math.min(200, rows.length - i)
  }

  // Promote the high-confidence ones into memory (expensive — costs prompt space every turn).
  // Supersede the previous copy of the same finding so memory does not grow a duplicate each night.
  let promoted = 0
  const toPromote = all.filter(f => f.promote)
  for (const f of toPromote) {
    try {
      const { data: prior } = await c.db.from('eve_memory').select('id')
        .eq('source', 'system').is('superseded_by', null)
        .contains('evidence', { finding: f.id }).limit(1)
      const supersedes = (prior || [])[0]?.id || null
      const saved = await saveMemory({
        kind: (f.memoryKind as any) || 'insight',
        text: `${f.title} — ${f.content}`.slice(0, 900),
        why: 'Found by the nightly learning sweep by counting real records.',
        scope: f.scope, weight: f.weight ?? 5, source: 'system',
        confidence: 0.7, evidence: { finding: f.id, evidence_count: f.evidence_count, sweptOn: c.today },
        supersedes,
      })
      if (saved.ok) promoted++
    } catch { /* one bad promotion must not stop the sweep */ }
  }

  return { ok: true, windowDays: c.days, miners: per, findings: all.length, knowledgeWritten: written, promotedToMemory: promoted, errors }
}

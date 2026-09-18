// THE OPERATOR'S REVIEW — Eve as chief of staff, once a week and on demand.
//
// Jon, 2026-09-18: "Questions are not very smart or intuitive, think higher level." and "We need
// Eve to get smarter so she can help us improve app, operations, create plans, improve checklists,
// improve our webapp, understanding of KPIs, etc."
//
// WHAT WAS WRONG. Everything Eve produced on her own was a LIST: findings from the sweep, audits,
// anomalies, template questions per building. Lists are what a database prints. Nobody was reading
// the week and saying "labor per clean in Broward went up because two vendor-covered turns were
// closed by roster names, and here is what to do about it". That sentence is the job.
//
// HOW THIS WORKS. The evidence pack is assembled DETERMINISTICALLY — every block is a query with a
// row cap and a "(+N more)" line, so the model never decides what data exists. Then ONE model call
// (task 'eve-review', Fable tier) reads the whole pack and writes: what moved and why, three to six
// ranked plans, critiques with evidence, and at most four questions the data cannot answer — each
// carrying the default she will assume if nobody replies. Plans go to the recommendation ledger
// (kind 'plan') so the grader measures them; questions go to eve_questions (kind 'plan') so the
// existing answer path files the reply as a memory with a name on it.
//
// THREE RULES THE PROMPT ENFORCES. She never restates the numbers, she explains them. She reasons
// from evidence to money and guest experience. She says "no signal" rather than inventing — an
// empty block is a real answer, and a review that fills silence with plausible prose is worse than
// a short one.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { modelPairFor } from '@/lib/ai-models'
import { anthropicMessages } from '@/lib/anthropic-call'
import { usageOf } from '@/lib/ai-usage'
import { buildScoreboard, type ScoreTile } from '@/lib/scoreboard'
import { FEATURES } from '@/lib/features'
import { rollupBuilding } from '@/lib/optimize-score'
import { minutesOf } from '@/lib/checklist-shared'
import { anomalyScan } from './trends'
import { listAudits } from './audit'
import { scorecard, createRecommendation } from './recommendations'
import { askQuestion, retireTemplateQuestions } from './questions'
import { METRIC_BY_KEY } from './metrics'
import { todayET, shiftDay, lc } from './ctx'
import { agentAllowed } from './agent-mode'

export type ReviewTrigger = 'weekly' | 'manual'
export type ReviewArea = 'operations' | 'checklist' | 'app' | 'guest' | 'money' | 'people'

export type ReviewMovement = { metric: string; what: string; why_hypothesis: string; evidence: string[]; confidence: 'high' | 'med' | 'low' }
export type ReviewPlan = {
  area: ReviewArea; title: string; problem: string; evidence: string[]; change: string; expected_effect: string
  cost: string; first_step: string; owner_suggestion: string
  /** Set by us after the model answers: the metric the grader will watch, and the ledger row. */
  metric?: string; expect_direction?: 'up' | 'down'; scope?: string; recommendation_id?: string | null
}
export type ReviewCritique = { target: 'checklist' | 'page' | 'automation' | 'rule' | 'kpi'; name: string; signal: string; verdict: string; change: string }
export type ReviewQuestion = { question: string; why_it_matters: string; what_i_will_assume: string; evidence: string[]; question_id?: string | null }
export type ReviewBody = {
  headline: string
  movements: ReviewMovement[]
  plans: ReviewPlan[]
  critiques: ReviewCritique[]
  questions: ReviewQuestion[]
  no_signal: string[]
}
export type ReviewRow = {
  id: string; at: string; trigger: string; focus: string | null; model: string | null; headline: string | null
  body: ReviewBody; pack_stats: any; usage: any; created_by: string | null
}

// ── The pack ───────────────────────────────────────────────────────────────────────────────────

/** A block of evidence: a title, capped lines, and how many were left out. */
type Block = { key: string; title: string; lines: string[]; total: number; cap: number; note?: string }

const CAPS = {
  anomalies: 25, sweep: 40, audits: 30, slackOpen: 30, slackClosed: 20, glitches: 30, reviews: 20,
  sentiment: 15, checklistItems: 20, usageViews: 15, usageUsers: 15, zeroPages: 30, rejected: 15, beliefs: 60,
} as const

/** Rough token estimate — four characters a token is close enough for a budget. */
const tokens = (s: string) => Math.ceil(s.length / 4)
const PACK_BUDGET = 25_000

function block(key: string, title: string, all: string[], cap: number, note?: string): Block {
  return { key, title, lines: all.slice(0, cap), total: all.length, cap, note }
}
function renderBlock(b: Block): string {
  const head = `## ${b.title}`
  if (!b.lines.length) return `${head}\n(no signal${b.note ? ' — ' + b.note : ''})`
  const more = b.total > b.lines.length ? `\n(+${b.total - b.lines.length} more)` : ''
  return `${head}${b.note ? '\n' + b.note : ''}\n${b.lines.join('\n')}${more}`
}

const fmt = (n: number | null | undefined, unit: string) => n == null ? '—' : unit.startsWith('$') ? '$' + Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10)
const dayOf = (v: any) => String(v || '').slice(0, 10)
const ago = (iso: any) => { const d = Date.parse(String(iso || '')); return Number.isFinite(d) ? Math.max(0, Math.round((Date.now() - d) / 864e5)) : null }
const clip = (s: any, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

async function safe<T>(fn: () => Promise<T>, fb: T): Promise<T> { try { return await fn() } catch { return fb } }

async function listingRollups(db: ReturnType<typeof supabaseAdmin>): Promise<Record<string, { name: string; building: string }>> {
  const out: Record<string, { name: string; building: string }> = {}
  const { data } = await db.from('guesty_listings').select('id,building,nickname,title').limit(1000)
  for (const l of ((data || []) as any[])) out[String(l.id)] = { name: String(l.nickname || l.title || l.id), building: rollupBuilding(l.building, l.nickname || l.title) }
  return out
}

function kpiBlock(tiles: ScoreTile[], weekStart: string, today: string): Block {
  const lines: string[] = []
  for (const t of tiles) {
    if (t.degraded) { lines.push(`- ${t.label}: could not read (${t.degraded})`); continue }
    const c = t.compare
    const cmp = c ? ` | this week ${fmt(c.now, c.unit)} vs same weekdays last week ${fmt(c.prev, c.unit)} (${c.unit})` : ''
    const d = t.delta ? ` | delta ${t.delta.value} (${t.delta.dir}; good when ${t.delta.goodWhen})` : ''
    lines.push(`- ${t.label}: ${t.value} · ${t.sub}${cmp}${d}`)
    if (t.detail?.note) lines.push(`    how it is computed: ${clip(t.detail.note, 260)}`)
    for (const r of t.detail.rows.slice(0, 4)) lines.push(`    · ${clip(r.text, 120)}`)
  }
  return { key: 'kpis', title: `WEEK KPIs — ${weekStart} to ${today} (Command Center scoreboard, lib/scoreboard)`, lines, total: lines.length, cap: lines.length }
}

export type Pack = { text: string; stats: Record<string, { total: number; shown: number }>; tokens: number; weekStart: string; today: string }

/** Assemble everything she is allowed to reason from. Deterministic; the model never picks data. */
export async function buildReviewPack(focus?: string): Promise<Pack> {
  const db = supabaseAdmin()
  const today = todayET()
  const d7 = shiftDay(today, -7), d14 = shiftDay(today, -14), d30 = shiftDay(today, -30)
  const iso7 = d7 + 'T00:00:00Z', iso14 = d14 + 'T00:00:00Z', iso30 = d30 + 'T00:00:00Z'

  const [board, anomalies, knowledge, audits, slackOpen, slackClosed, glitches, reviews, sentiment, checklist, activity, score, rejected, beliefs, meta] = await Promise.all([
    safe(() => buildScoreboard(), null as any),
    safe(() => anomalyScan({ days: 14, sigma: 2 }), { scanned: 0, anomalies: [], note: 'anomaly scan failed' } as any),
    safe(async () => (await db.from('eve_knowledge').select('type,scope,title,content,evidence_count,updated_at').gte('updated_at', iso7).order('evidence_count', { ascending: false }).limit(200)).data || [], [] as any[]),
    safe(() => listAudits({ status: 'open', limit: 100 }), [] as any[]),
    safe(async () => (await db.from('eve_slack_items').select('kind,unit,building,summary,owner_name,first_seen,urgent,channel_name').eq('status', 'open').order('first_seen').limit(200)).data || [], [] as any[]),
    safe(async () => (await db.from('eve_slack_items').select('kind,unit,summary,closed_reason,closed_at').eq('status', 'closed').gte('closed_at', iso7).order('closed_at', { ascending: false }).limit(100)).data || [], [] as any[]),
    safe(async () => (await db.from('glitches').select('unit,status,overview,glitch_type,category,created_at,closed_at,assignee').or(`created_at.gte.${iso14},closed_at.gte.${iso14}`).order('created_at', { ascending: false }).limit(200)).data || [], [] as any[]),
    safe(async () => (await db.from('guesty_reviews').select('listing_id,rating,content,created_at,channel,has_reply').eq('excluded_from_score', false).lte('rating', 3).gte('created_at', iso14).order('created_at', { ascending: false }).limit(100)).data || [], [] as any[]),
    safe(async () => (await db.from('guesty_conversation_sentiment').select('listing_id,top_issue,reason,last_message_at').eq('dissatisfied', true).gte('last_message_at', iso7).order('last_message_at', { ascending: false }).limit(100)).data || [], [] as any[]),
    safe(async () => {
      const [items, ticks] = await Promise.all([
        db.from('daily_checklist_items').select('id,title,by_time,band,owner_role,active').limit(200),
        db.from('daily_checklist_ticks').select('item_id,day,done_at').gte('day', d7).lte('day', today).limit(2000),
      ])
      return { items: (items.data || []) as any[], ticks: (ticks.data || []) as any[] }
    }, { items: [] as any[], ticks: [] as any[] }),
    safe(async () => {
      // Page views only, capped at 5,000 rows — the shape of use, not an audit log.
      const rows: any[] = []
      for (let page = 0; page < 5; page++) {
        const { data, error } = await db.from('user_activity').select('email,path').eq('kind', 'page').gte('at', iso14).order('id').range(page * 1000, page * 1000 + 999)
        if (error) break
        rows.push(...(data || []))
        if ((data || []).length < 1000) break
      }
      return rows
    }, [] as any[]),
    safe(() => scorecard(), null as any),
    safe(async () => (await db.from('eve_recommendations').select('title,decision_note,decided_at,metric,scope').eq('status', 'rejected').gte('created_at', iso30).order('decided_at', { ascending: false }).limit(40)).data || [], [] as any[]),
    safe(async () => (await db.from('eve_memory').select('kind,text,scope,weight,source').in('source', ['jon', 'system']).gte('weight', 7).is('superseded_by', null).order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(200)).data || [], [] as any[]),
    safe(() => listingRollups(db), {} as Record<string, { name: string; building: string }>),
  ])

  const blocks: Block[] = []
  const nameOf = (lid: any) => meta[String(lid)]?.name || String(lid || 'unknown unit')
  const bldgOf = (lid: any) => meta[String(lid)]?.building || ''

  // 1. Week KPIs
  if (board) blocks.push(kpiBlock(board.tiles, board.weekStart, board.today))
  else blocks.push(block('kpis', 'WEEK KPIs', [], 0, 'scoreboard could not be built'))

  // 2. Anomalies
  blocks.push(block('anomalies', 'ANOMALIES — 14-day window vs each scope\'s own 90-day norm (2 sigma)',
    (anomalies.anomalies || []).map((a: any) => `- ${a.scope} · ${a.label}: now ${a.current} vs norm ${a.baselineMean} — ${a.verdict}`),
    CAPS.anomalies, anomalies.note))

  // 3. Sweep findings + audits
  blocks.push(block('sweep', 'SWEEP FINDINGS — last 7 days, by evidence count (eve_knowledge)',
    (knowledge as any[]).map(k => `- [${k.type} · ${k.scope}] ${clip(k.title, 120)}: ${clip(k.content, 200)} (n=${k.evidence_count})`), CAPS.sweep))
  blocks.push(block('audits', 'OPEN AUDIT FINDINGS — severity warn or critical (eve_audits)',
    (audits as any[]).filter(a => a.severity !== 'info').map(a => `- [${a.severity} · ${a.area}] ${clip(a.title, 120)} — open ${a.ageDays}d · ${clip(a.detail, 160)}${a.fix ? ' · fix: ' + clip(a.fix, 120) : ''}`), CAPS.audits))

  // 4. Slack watch
  blocks.push(block('slack_open', 'SLACK WATCH — open items (eve_slack_items)',
    (slackOpen as any[]).map(s => `- [${s.kind}${s.urgent ? ' · URGENT' : ''}] ${s.unit || s.building || '—'}: ${clip(s.summary, 160)} · ${s.owner_name || 'no owner'} · open ${ago(s.first_seen) ?? '?'}d · ${s.channel_name || ''}`), CAPS.slackOpen))
  blocks.push(block('slack_closed', 'SLACK WATCH — closed in the last 7 days, with why',
    (slackClosed as any[]).map(s => `- [${s.kind}] ${s.unit || '—'}: ${clip(s.summary, 120)} → ${clip(s.closed_reason, 100) || 'no reason recorded'}`), CAPS.slackClosed))

  // 5. Glitches, low reviews, sentiment
  const gl = (glitches as any[])
  const opened = gl.filter(g => dayOf(g.created_at) >= d14)
  const closedG = gl.filter(g => g.closed_at && dayOf(g.closed_at) >= d14)
  blocks.push(block('glitches', `GUEST ISSUES (glitches) — ${opened.length} opened, ${closedG.length} closed in 14 days`,
    gl.map(g => `- ${g.unit || 'Unit'} · ${g.status}${g.closed_at ? ' (closed ' + dayOf(g.closed_at) + ')' : ''} · opened ${dayOf(g.created_at)}: ${clip(g.overview || g.glitch_type || g.category, 140)}${g.assignee ? ' · ' + g.assignee : ''}`), CAPS.glitches))
  blocks.push(block('reviews', 'REVIEWS AT 3 STARS OR BELOW — last 14 days',
    (reviews as any[]).map(r => `- ${r.rating}★ ${nameOf(r.listing_id)} (${bldgOf(r.listing_id)}) · ${dayOf(r.created_at)} · ${r.channel || ''}${r.has_reply ? '' : ' · UNANSWERED'}: "${clip(r.content, 220)}"`), CAPS.reviews))
  blocks.push(block('sentiment', 'DISSATISFIED GUEST THREADS — last 7 days (sentiment scan)',
    (sentiment as any[]).map(s => `- ${nameOf(s.listing_id)} (${bldgOf(s.listing_id)}) · ${dayOf(s.last_message_at)}: ${clip(s.top_issue, 60)}${s.reason ? ' — ' + clip(s.reason, 140) : ''}`), CAPS.sentiment))

  // 6. Checklist — completion per day and chronic items
  {
    const items = checklist.items.filter((i: any) => i.active !== false)
    const byItem: Record<string, any> = {}
    for (const i of items) byItem[String(i.id)] = i
    const days: string[] = []
    for (let d = d7; d < today; d = shiftDay(d, 1)) days.push(d)
    const perDay: string[] = []
    const late: Record<string, number> = {}, done: Record<string, number> = {}
    for (const d of days) {
      const dayTicks = checklist.ticks.filter((t: any) => dayOf(t.day) === d)
      perDay.push(`${d}: ${dayTicks.length}/${items.length} ticked`)
      for (const t of dayTicks) {
        const it = byItem[String(t.item_id)]
        if (!it) continue
        done[it.id] = (done[it.id] || 0) + 1
        const by = minutesOf(it.by_time)
        if (by != null && t.done_at) {
          const local = new Date(t.done_at).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
          const m = minutesOf(local)
          if (m != null && m > by + 30) late[it.id] = (late[it.id] || 0) + 1
        }
      }
    }
    const chronic = items.map((i: any) => ({ i, skipped: days.length - (done[i.id] || 0), late: late[i.id] || 0 }))
      .filter(x => x.skipped >= 2 || x.late >= 2)
      .sort((a, b) => (b.skipped + b.late) - (a.skipped + a.late))
      .map(x => `- "${clip(x.i.title, 80)}" (${x.i.band}${x.i.by_time ? ' by ' + String(x.i.by_time).slice(0, 5) : ''}${x.i.owner_role ? ' · ' + x.i.owner_role : ''}): skipped ${x.skipped} of ${days.length} days, late ${x.late}`)
    const lines = items.length ? [`Completion by day (${items.length} active items): ` + (perDay.join(' · ') || 'no complete days yet'), ...chronic] : []
    blocks.push(block('checklist', 'DAILY CHECKLIST — last 7 days (daily_checklist_ticks)', lines, CAPS.checklistItems + 1, items.length ? (chronic.length ? undefined : 'no item was chronically late or skipped') : 'no checklist items configured'))
  }

  // 7. App usage
  {
    const views: Record<string, number> = {}, users: Record<string, Record<string, true>> = {}
    for (const r of activity as any[]) {
      const p = String(r.path || '').split('?')[0] || '/'
      views[p] = (views[p] || 0) + 1
      if (!users[p]) users[p] = {}
      users[p][String(r.email || '')] = true
    }
    const paths = Object.keys(views)
    const byViews = paths.slice().sort((a, b) => views[b] - views[a]).slice(0, CAPS.usageViews).map(p => `- ${p}: ${views[p]} views · ${Object.keys(users[p]).length} people`)
    const byUsers = paths.slice().sort((a, b) => Object.keys(users[b]).length - Object.keys(users[a]).length).slice(0, CAPS.usageUsers).map(p => `- ${p}: ${Object.keys(users[p]).length} people · ${views[p]} views`)
    const seen: Record<string, true> = {}
    for (const p of paths) { seen[p] = true; seen[p.replace(/\/$/, '')] = true }
    const zero = FEATURES.filter(f => !seen[f.path] && !paths.some(p => p.startsWith(f.path + '/'))).map(f => `- ${f.label} (${f.path}, ${f.group})`)
    const total = (activity as any[]).length
    blocks.push(block('usage', `APP USAGE — page views, last 14 days (${total} views across ${paths.length} paths, ${Object.keys(users).length ? new Set((activity as any[]).map(r => String(r.email || ''))).size : 0} people)`,
      total ? ['Most viewed:', ...byViews, 'Most people:', ...byUsers] : [], CAPS.usageViews + CAPS.usageUsers + 2, total ? undefined : 'no page views recorded (user_activity)'))
    blocks.push(block('zero_pages', 'REGISTERED PAGES NOBODY OPENED in 14 days (lib/features FEATURES — the sidebar tabs plus a few URL-only tools)', zero, CAPS.zeroPages, total ? undefined : 'cannot tell without activity rows'))
  }

  // 8. Track record
  {
    const lines: string[] = []
    if (score?.available) lines.push(`- ${score.total} logged · ${score.accepted} accepted · ${score.rejected} rejected · ${score.graded} graded: ${score.worked} worked, ${score.didnt} didn't, ${score.inconclusive} inconclusive${score.hit_rate != null ? ' · hit rate ' + score.hit_rate + '%' : ''}${score.note ? ' · ' + score.note : ''}`)
    for (const r of (rejected as any[]).slice(0, CAPS.rejected)) lines.push(`- REJECTED "${clip(r.title, 100)}" (${r.metric} · ${r.scope})${r.decision_note ? ': ' + clip(r.decision_note, 140) : ''}`)
    blocks.push({ key: 'track', title: 'MY TRACK RECORD — and what Jon turned down in 30 days', lines, total: lines.length + Math.max(0, (rejected as any[]).length - CAPS.rejected), cap: lines.length })
  }

  // 9. Beliefs — scope-matched to the focus when there is one, portfolio always
  {
    const f = lc(focus || '')
    const rows = (beliefs as any[]).filter(m => {
      const sc = String(m.scope || 'portfolio')
      if (sc === 'portfolio') return true
      const name = sc.replace(/^(building|unit|person):/, '')
      return !!f && f.includes(lc(name))
    })
    blocks.push(block('beliefs', 'WHAT I ALREADY BELIEVE — rules Jon stated or the system proved, weight 7+ (eve_memory)',
      rows.map(m => `- [${m.kind} · ${m.scope} · ${m.source}] ${clip(m.text, 220)}`), CAPS.beliefs))
  }

  // Budget: render, and if the whole thing is over budget, halve the biggest blocks until it fits.
  const stats: Record<string, { total: number; shown: number }> = {}
  let text = ''
  for (let round = 0; round < 6; round++) {
    text = blocks.map(renderBlock).join('\n\n')
    if (tokens(text) <= PACK_BUDGET) break
    const biggest = blocks.slice().sort((a, b) => renderBlock(b).length - renderBlock(a).length)[0]
    if (!biggest || biggest.lines.length <= 3 || biggest.key === 'kpis') break
    biggest.lines = biggest.lines.slice(0, Math.max(3, Math.floor(biggest.lines.length / 2)))
  }
  for (const b of blocks) stats[b.key] = { total: b.total, shown: b.lines.length }
  return { text, stats, tokens: tokens(text), weekStart: board?.weekStart || d7, today }
}

// ── The prompt ─────────────────────────────────────────────────────────────────────────────────

const METRIC_KEYS = Object.keys(METRIC_BY_KEY)


// The contract the model fills. Kept loose on purpose (strings, arrays of strings) — normalizeBody
// still coerces, so a field the model leaves out becomes an empty list, never a crash.
const S_ARR = { type: 'array', items: { type: 'string' } }
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    movements: { type: 'array', items: { type: 'object', properties: {
      metric: { type: 'string' }, what: { type: 'string' }, why_hypothesis: { type: 'string' }, evidence: S_ARR,
      confidence: { type: 'string', enum: ['high', 'med', 'low'] } }, required: ['metric', 'what', 'why_hypothesis'] } },
    plans: { type: 'array', items: { type: 'object', properties: {
      area: { type: 'string', enum: ['operations', 'checklist', 'app', 'guest', 'money', 'people'] },
      title: { type: 'string' }, problem: { type: 'string' }, evidence: S_ARR, change: { type: 'string' },
      expected_effect: { type: 'string' }, cost: { type: 'string' }, first_step: { type: 'string' }, owner_suggestion: { type: 'string' },
      metric: { type: 'string' } }, required: ['area', 'title', 'problem', 'change', 'expected_effect', 'first_step'] } },
    critiques: { type: 'array', items: { type: 'object', properties: {
      target: { type: 'string', enum: ['checklist', 'page', 'automation', 'rule', 'kpi'] }, name: { type: 'string' },
      signal: { type: 'string' }, verdict: { type: 'string' }, change: { type: 'string' } }, required: ['target', 'name', 'signal', 'verdict'] } },
    questions: { type: 'array', items: { type: 'object', properties: {
      question: { type: 'string' }, why_it_matters: { type: 'string' }, what_i_will_assume: { type: 'string' }, evidence: S_ARR },
      required: ['question', 'why_it_matters', 'what_i_will_assume'] } },
    no_signal: S_ARR,
  },
  required: ['headline', 'movements', 'plans', 'questions'],
}

const SYSTEM = `You are Eve, chief of staff to the operations director of Stay Hospitality — about 230 short-term-rental units across Miami, Broward and West Palm Beach, run from a web app called Lighthouse (Guesty for bookings and guest messages, Breezeway for tasks, Homebase for the crew's hours, Slack for the team). You are writing the operator's review: the thing Jon reads on Monday to decide what to change this week.

WHO YOU ARE WRITING FOR. Jon owns the company and runs operations. He has seen every number already. He does not need the numbers repeated; he needs to know WHAT MOVED, WHY, and WHAT TO DO. You reason from evidence to two things that matter: money (labor per clean, maintenance labor, billable recovery, claims, revenue) and guest experience (reviews, sentiment, glitches, response). Everything else is a means.

RULES.
1. NEVER RESTATE A NUMBER AS A FINDING. "Labor per clean in Broward was $41" is a tile. "Labor per clean in Broward rose because three vendor-building turns were closed by roster names and their wages landed in our bucket" is a finding. Every movement needs a why_hypothesis that names a mechanism, and the evidence lines that support it — copied or closely paraphrased from the pack, never invented.
2. SAY "NO SIGNAL" RATHER THAN INVENT. If a block is empty or too thin, list it in no_signal and move on. An honest short review beats a plausible long one. Never fabricate a unit, a person, a number or a cause that is not in the pack.
3. PLANS ARE CHANGES, NOT ADVICE. Each plan names the problem, the evidence, the specific change, the expected effect on a money or guest number, the cost (time, dollars or risk), the very first step somebody can take today, and who should own it. Three to six plans, ranked by dollar or guest impact, biggest first. A plan can be about operations, the daily checklist, the app itself (a page nobody opens, a KPI computed misleadingly, an automation that is off or noisy), guests, money or people. Prefer one plan that fixes a cause over three that treat symptoms.
4. CRITIQUES ONLY WITH EVIDENCE. If the pack shows a checklist item skipped five of seven days, a sidebar page nobody opened, an automation whose findings nobody acts on, a rule you were told that the data contradicts, or a KPI whose formula misleads — say so, with the signal. If there is no such evidence, return an empty critiques array. Do not critique to fill space.
5. QUESTIONS ARE RARE AND EARNED. At most four, and only for things the pack genuinely cannot answer — a policy, a reason behind a pattern, a decision only Jon can make. Never ask for a number you could have been given. Each question carries why it matters and what_i_will_assume: the default you will act on if nobody answers, so silence is not a blocker.
6. WEIGH YOUR OWN RECORD. If Jon rejected plans of a certain shape, do not propose that shape again without saying why this one is different. If your hit rate is unknown, say the plans are unproven.
7. RESPECT WHO DOES WHAT. Buildings the beliefs mark as vendor-run or hotel-operated are not our labor: a late clean there is the vendor's, and cost per clean does not exist for us. Do not attribute hands-on work to our crew in those buildings.
8. Be concrete and plain. No headings inside strings, no markdown, no emoji. British-free American spelling. Short sentences.

Deliver the review through the operator_review tool. Its fields:
{"headline": "<one sentence: the week in one line — the biggest movement and its cause>",
 "movements": [{"metric": "<KPI or metric name>", "what": "<what changed, in plain words>", "why_hypothesis": "<the mechanism you believe explains it>", "evidence": ["<line from the pack>", "..."], "confidence": "high"|"med"|"low"}],
 "plans": [{"area": "operations"|"checklist"|"app"|"guest"|"money"|"people", "title": "<imperative, one line>", "problem": "<what is wrong and what it costs>", "evidence": ["..."], "change": "<the specific change>", "expected_effect": "<which number moves, which way, roughly how much, by when>", "cost": "<time, dollars or risk>", "first_step": "<something someone can do today>", "owner_suggestion": "<role or person>", "metric": "<one of: ${METRIC_KEYS.join(', ')}>", "expect_direction": "up"|"down", "scope": "portfolio"|"building:<Name>"}],
 "critiques": [{"target": "checklist"|"page"|"automation"|"rule"|"kpi", "name": "<what it is>", "signal": "<the evidence>", "verdict": "<what is wrong with it>", "change": "<what to do instead>"}],
 "questions": [{"question": "<the question>", "why_it_matters": "<what changes depending on the answer>", "what_i_will_assume": "<your default>", "evidence": ["..."]}],
 "no_signal": ["<block or topic with nothing to say>", "..."]}`

function parseJson(raw: string): any | null {
  const t = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = t(raw) || t(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = t(raw.slice(a, b + 1)) }
  if (!o) {
    // Prose after the object that itself contains a brace defeats lastIndexOf: walk from the first
    // '{' to its matching '}' (string-aware) and parse just that.
    const a = raw.indexOf('{')
    if (a !== -1) {
      let depth = 0, inStr = false, esc = false
      for (let i = a; i < raw.length; i++) {
        const ch = raw[i]
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
        if (ch === '"') inStr = true
        else if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { o = t(raw.slice(a, i + 1)); break } }
      }
    }
  }
  return o && typeof o === 'object' && !Array.isArray(o) ? o : null
}

const AREAS: ReviewArea[] = ['operations', 'checklist', 'app', 'guest', 'money', 'people']
const strs = (v: any, n = 8): string[] => Array.isArray(v) ? v.map(x => clip(x, 300)).filter(Boolean).slice(0, n) : []

/** Coerce whatever came back into the shape the page and the ledger expect. */
function normalizeBody(o: any): ReviewBody {
  const movements: ReviewMovement[] = (Array.isArray(o?.movements) ? o.movements : []).slice(0, 10).map((m: any) => ({
    metric: clip(m?.metric, 80), what: clip(m?.what, 400), why_hypothesis: clip(m?.why_hypothesis, 600), evidence: strs(m?.evidence),
    confidence: (['high', 'med', 'low'] as const).includes(m?.confidence) ? m.confidence : 'low',
  })).filter((m: ReviewMovement) => m.what)
  const plans: ReviewPlan[] = (Array.isArray(o?.plans) ? o.plans : []).slice(0, 6).map((p: any) => ({
    area: AREAS.includes(p?.area) ? p.area : 'operations',
    title: clip(p?.title, 200), problem: clip(p?.problem, 600), evidence: strs(p?.evidence), change: clip(p?.change, 800),
    expected_effect: clip(p?.expected_effect, 400), cost: clip(p?.cost, 300), first_step: clip(p?.first_step, 300), owner_suggestion: clip(p?.owner_suggestion, 80),
    metric: METRIC_BY_KEY[String(p?.metric || '')] ? String(p.metric) : undefined,
    expect_direction: p?.expect_direction === 'down' ? 'down' : 'up',
    scope: /^(portfolio|building:.+)$/.test(String(p?.scope || '')) ? String(p.scope) : 'portfolio',
  })).filter((p: ReviewPlan) => p.title)
  const critiques: ReviewCritique[] = (Array.isArray(o?.critiques) ? o.critiques : []).slice(0, 8).map((c: any) => ({
    target: (['checklist', 'page', 'automation', 'rule', 'kpi'] as const).includes(c?.target) ? c.target : 'rule',
    name: clip(c?.name, 120), signal: clip(c?.signal, 400), verdict: clip(c?.verdict, 400), change: clip(c?.change, 400),
  })).filter((c: ReviewCritique) => c.name && c.signal)
  const questions: ReviewQuestion[] = (Array.isArray(o?.questions) ? o.questions : []).slice(0, 4).map((q: any) => ({
    question: clip(q?.question, 400), why_it_matters: clip(q?.why_it_matters, 400), what_i_will_assume: clip(q?.what_i_will_assume, 300), evidence: strs(q?.evidence, 4),
  })).filter((q: ReviewQuestion) => q.question)
  return { headline: clip(o?.headline, 300) || 'No headline.', movements, plans, critiques, questions, no_signal: strs(o?.no_signal, 20) }
}

/** A plan without a gradable metric gets the closest one from its area, so the ledger can still measure it. */
function metricFor(p: ReviewPlan): string {
  if (p.metric) return p.metric
  const t = lc(p.title + ' ' + p.problem + ' ' + p.expected_effect)
  if (/clean|housekeep|turn/.test(t) && /minute|time|hour/.test(t)) return 'clean_minutes'
  if (/unassigned|nobody on/.test(t)) return 'cleans_unassigned'
  if (/review|star/.test(t)) return 'review_avg'
  if (/sentiment|unhappy|dissatisf/.test(t)) return 'sentiment_negative'
  if (/glitch|guest issue|complaint/.test(t)) return 'glitches_new'
  if (/cancel/.test(t)) return 'cancel_rate'
  if (/direct/.test(t)) return 'direct_share'
  if (/revenue|adr|rate/.test(t)) return 'revenue'
  if (/occupancy|nights/.test(t)) return 'occupancy'
  return p.area === 'guest' ? 'review_avg' : p.area === 'money' ? 'revenue' : 'glitches_new'
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

export type ReviewResult = { ok: true; id: string | null; review: ReviewBody; model: string; pack: { tokens: number; stats: Pack['stats'] }; persisted: { plans: number; questions: number; retired: number } } | { ok: false; error: string; pack?: { tokens: number; stats: Pack['stats'] } }

/**
 * One review: build the pack, one model call, persist the row plus each plan as a recommendation
 * and each question as an eve_question. `focus` steers the review ("labor per clean in Broward")
 * without changing what evidence she sees — the pack is the same either way.
 */
export async function runReview(opts: { trigger: ReviewTrigger; focus?: string; by?: string }): Promise<ReviewResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const focus = clip(opts.focus, 300) || ''
  const pack = await buildReviewPack(focus || undefined)

  const { model, fallback } = await modelPairFor('eve-review')
  const user = [
    `DATE: ${pack.today} (week starting ${pack.weekStart}). TRIGGER: ${opts.trigger}.`,
    focus ? `FOCUS: Jon asked specifically about "${focus}". Lead with that; the plans should serve it; still report any movement elsewhere that matters more.` : 'FOCUS: none — the whole week.',
    '',
    'EVIDENCE PACK (every block is capped; "(+N more)" means rows exist that you were not shown — say so if it matters):',
    '',
    pack.text,
  ].join('\n')

  let body: ReviewBody
  let answeredBy = model
  let usage: any = null
  try {
    // No temperature: the Fable tier rejects it. max_tokens 6000 leaves room for six full plans.
    // STRUCTURED OUTPUT VIA A FORCED TOOL CALL (2026-09-18). The first live run came back as prose
    // around the JSON and failed to parse. A tool_choice-forced call returns the object as
    // tool input, validated against the schema, with no fences and no preamble to strip.
    const r = await anthropicMessages(key, {
      model, max_tokens: 6000, system: SYSTEM,
      tools: [{ name: 'operator_review', description: 'Deliver the operator review as structured data.', input_schema: REVIEW_SCHEMA }],
      tool_choice: { type: 'tool', name: 'operator_review' },
      messages: [{ role: 'user', content: user }],
    }, fallback, 'eve-review')
    answeredBy = r.model
    usage = usageOf(r.data)
    if (!r.ok) return { ok: false, error: clip(r.data?.error?.message, 200) || `model call failed (${r.status})`, pack: { tokens: pack.tokens, stats: pack.stats } }
    const toolUse = (r.data?.content || []).find((c: any) => c.type === 'tool_use' && c.input && typeof c.input === 'object')
    const text = (r.data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => String(c.text || '')).join('\n')
    const parsed = toolUse ? toolUse.input : parseJson(text)
    if (!parsed) return { ok: false, error: 'model answer was not JSON: ' + clip(text || r.data?.stop_reason, 160), pack: { tokens: pack.tokens, stats: pack.stats } }
    body = normalizeBody(parsed)
  } catch (e: any) {
    return { ok: false, error: clip(e?.message || e, 200), pack: { tokens: pack.tokens, stats: pack.stats } }
  }

  // Nothing below runs unless the model answered: a failed call persists no row, no plans, no
  // questions, and leaves the template questions alone. The templates retire on the first review
  // that actually lands, and any run after that finds nothing.
  let retired = 0
  try { retired = (await retireTemplateQuestions()).retired } catch { /* cosmetic */ }

  // Persist the review row first so plans and questions can point back at it.
  const db = supabaseAdmin()
  let id: string | null = null
  try {
    const { data, error } = await db.from('eve_reviews').insert({
      trigger: opts.trigger, focus: focus || null, model: answeredBy, headline: body.headline,
      body, pack_stats: { tokens: pack.tokens, blocks: pack.stats, retired }, usage, created_by: opts.by || null,
    }).select('id').maybeSingle()
    if (!error) id = (data as any)?.id || null
  } catch { /* the review still returns; only the history is lost */ }

  // Each plan becomes a recommendation the grader can measure — unless Agent mode has the ledger
  // at observe, in which case the review is still written but nothing is filed for a decision.
  let plans = 0
  const recGate = await agentAllowed('recommendation')
  for (const p of (recGate.mode === 'observe' ? [] : body.plans)) {
    const metric = metricFor(p)
    const detail = [
      `PROBLEM: ${p.problem}`, `CHANGE: ${p.change}`, `EXPECTED: ${p.expected_effect}`, `COST: ${p.cost}`,
      `FIRST STEP: ${p.first_step}`, `OWNER: ${p.owner_suggestion}`, p.evidence.length ? `EVIDENCE:\n- ${p.evidence.join('\n- ')}` : '',
    ].filter(Boolean).join('\n')
    const r = await createRecommendation({
      title: p.title, detail, scope: p.scope || 'portfolio', metric, expect_direction: p.expect_direction || 'up',
      measure_in_days: 21, created_by: opts.by || 'eve-review', source: 'review', kind: 'plan', review_id: id, area: p.area,
    })
    p.metric = metric
    p.recommendation_id = r.ok ? (r.id || null) : null
    if (r.ok) plans++
  }

  // Each question goes through the same door as every other — deduped, answerable on /command.
  let questions = 0
  for (const q of body.questions) {
    const r = await askQuestion({
      question: q.question, why: q.why_it_matters || 'It changes which plan I would put first.',
      scope: 'portfolio', kind: 'plan', source: 'review',
      evidence: { review_id: id, what_i_will_assume: q.what_i_will_assume, evidence: q.evidence },
    })
    q.question_id = r.ok ? (r.id || null) : null
    if (r.ok && !r.repeated) questions++
  }

  // Keep the persisted body in step with the ids we just minted.
  if (id) { try { await db.from('eve_reviews').update({ body }).eq('id', id) } catch { /* fine */ } }

  return { ok: true, id, review: body, model: answeredBy, pack: { tokens: pack.tokens, stats: pack.stats }, persisted: { plans, questions, retired } }
}

export async function listReviews(limit = 5): Promise<ReviewRow[]> {
  try {
    const { data, error } = await supabaseAdmin().from('eve_reviews').select('*').order('at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 20))
    if (error) return []
    return (data || []) as any
  } catch { return [] }
}

/** The latest review's plans still waiting on a decision — the Command Center's Decide band reads this. */
export async function latestReviewPlans(): Promise<{ review_id: string | null; at: string | null; headline: string | null; plans: any[] }> {
  const rows = await listReviews(1)
  const latest = rows[0]
  if (!latest) return { review_id: null, at: null, headline: null, plans: [] }
  try {
    const { data } = await supabaseAdmin().from('eve_recommendations').select('id,title,detail,scope,metric,area,status,created_at')
      .eq('review_id', latest.id).eq('status', 'open').order('created_at').limit(10)
    return { review_id: latest.id, at: latest.at, headline: latest.headline, plans: (data || []) as any[] }
  } catch { return { review_id: latest.id, at: latest.at, headline: latest.headline, plans: [] } }
}

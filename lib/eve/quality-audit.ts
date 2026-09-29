// THE QUALITY AUDITOR — three real weaknesses a week, with evidence, graded later.
//
// Jon, 2026-09-28 (from the roadmap: "identify real weaknesses, communicate them, implement
// them"): every Monday, the three things most costing us reviews and revenue on the quality side,
// each with the evidence behind it, a root cause, one concrete action and a metric that will say
// in three weeks whether it worked. Not a dashboard — a dashboard already exists — a judgement.
//
// SAME SHAPE AS THE OPERATOR'S REVIEW (lib/eve/review.ts), narrower pack. The evidence is assembled
// deterministically, every block capped, and ONE model call (the review tier) reads it and returns
// structured findings through a forced tool call. Each finding is filed as a recommendation of
// kind 'plan' in area 'quality', so the grader measures it against the metric it named; a finding
// with no measurable metric is not a finding. A short version goes to #leadership through the
// slack_post rung — propose = a ✅ sends it.
//
// WHAT COUNTS AS EVIDENCE HERE (90 days unless stated):
//   1. repeat guest issues per unit — the glitch board, grouped, with what keeps breaking
//   2. what guests write in low reviews, by theme and by building (review_actions + guesty_reviews)
//   3. the crews: catch rate, miss rate, caught-but-not-fixed (lib/eve/accountability, 60 days)
//   4. bad-review inspections: raised, walked, still open (auto_inspections rev: rows)
//   5. unhappy guest threads by building (guesty_conversation_sentiment, 30 days)
// Every block prints its totals so the model can say "no signal" for an empty one.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { modelPairFor } from '@/lib/ai-models'
import { anthropicMessages } from '@/lib/anthropic-call'
import { usageOf } from '@/lib/ai-usage'
import { postToChannel } from '@/lib/slack'
import { EVE_CHANNELS } from '@/lib/slack-rules'
import { rollupBuilding } from '@/lib/optimize-score'
import { crewScorecard } from './accountability'
import { createRecommendation } from './recommendations'
import { agentAllowed, stepDown } from './agent-mode'
import { todayET, shiftDay, lc } from './ctx'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (v: any, n: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, n)
const norm5 = (v: any) => { const n = Number(v); return Number.isFinite(n) ? (n > 5 ? n / 2 : n) : NaN }

const METRICS_ALLOWED = ['low_reviews', 'glitches_new', 'sentiment_negative', 'five_star_share', 'review_avg', 'glitches_open', 'unanswered_reviews'] as const
type MetricKey = typeof METRICS_ALLOWED[number]

export type QualityPack = { text: string; stats: Record<string, { total: number; shown: number }>; today: string; from: string }

export async function buildQualityPack(days = 90): Promise<QualityPack> {
  const db = supabaseAdmin()
  const today = todayET(), from = shiftDay(today, -days), from30 = shiftDay(today, -30), from60 = shiftDay(today, -60)
  const stats: QualityPack['stats'] = {}
  const blocks: string[] = []
  const meta: Record<string, { unit: string; building: string }> = {}
  {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building').limit(3000)
    for (const l of ((data || []) as any[])) { const unit = str(l.nickname || l.title) || str(l.id); meta[str(l.id)] = { unit, building: rollupBuilding(l.building, unit) } }
  }
  const nameOf = (lid: any) => meta[str(lid)]?.unit || str(lid)
  const bldOf = (lid: any) => meta[str(lid)]?.building || ''

  // 1. repeat guest issues per unit
  try {
    const { data } = await db.from('glitches').select('id,listing_id,unit,category,overview,status,created_at').gte('created_at', from + 'T00:00:00Z').limit(3000)
    const rows = ((data || []) as any[])
    const byUnit: Record<string, { n: number; open: number; cats: Record<string, number>; last: string; unit: string; building: string }> = {}
    for (const g of rows) {
      const k = str(g.listing_id) || str(g.unit)
      const e = byUnit[k] = byUnit[k] || { n: 0, open: 0, cats: {}, last: '', unit: g.listing_id ? nameOf(g.listing_id) : str(g.unit), building: g.listing_id ? bldOf(g.listing_id) : rollupBuilding(null, str(g.unit)) }
      e.n++; if (!/closed|resolved|done|complete/i.test(str(g.status))) e.open++
      const c = clip(g.category || g.overview, 30).toLowerCase() || 'other'; e.cats[c] = (e.cats[c] || 0) + 1
      if (str(g.created_at) > e.last) e.last = str(g.created_at).slice(0, 10)
    }
    const top = Object.values(byUnit).filter(e => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, 10)
    const byB: Record<string, number> = {}; for (const e of Object.values(byUnit)) byB[e.building || '?'] = (byB[e.building || '?'] || 0) + e.n
    stats.glitches = { total: rows.length, shown: top.length }
    blocks.push(`## GUEST ISSUES (glitch board), ${days} days — ${rows.length} total\nBy building: ${Object.entries(byB).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([b, n]) => `${b} ${n}`).join(' · ') || 'none'}\nUnits with 2+ issues (unit · building · count · open · what keeps breaking · last):\n` +
      (top.map(e => `- ${e.unit} · ${e.building} · ${e.n} · ${e.open} open · ${Object.entries(e.cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}×${n}`).join(', ')} · ${e.last}`).join('\n') || '- none'))
  } catch (e: any) { blocks.push(`## GUEST ISSUES — unavailable (${clip(e?.message, 80)})`) }

  // 2. what low reviews say
  try {
    const { data } = await db.from('guesty_reviews').select('listing_id,rating,content,channel,created_at').gte('created_at', from + 'T00:00:00Z').eq('excluded_from_score', false).is('removed_at', null).order('created_at', { ascending: false }).limit(3000)
    const rows = ((data || []) as any[])
    const low = rows.filter(r => { const n = norm5(r.rating); return Number.isFinite(n) && n > 0 && n <= 3 })
    const byB: Record<string, { n: number; low: number }> = {}
    for (const r of rows) { const b = bldOf(r.listing_id) || '?'; const e = byB[b] = byB[b] || { n: 0, low: 0 }; e.n++; if (low.includes(r)) e.low++ }
    const THEMES: [string, RegExp][] = [['cleanliness', /dirty|clean|dust|hair|stain|smell|odor|mold|roach|bug|ant\b/i], ['a/c & temperature', /\bac\b|a\/c|air con|hot inside|cold|thermostat|hvac/i], ['check-in & access', /check.?in|code|lock|key|door|access|lockbox|front desk|parking/i], ['wifi & tv', /wifi|wi-fi|internet|tv\b|remote|cable/i], ['noise', /noise|noisy|loud|construction/i], ['maintenance', /broken|not work|leak|repair|fix|toilet|shower|water pressure|hot water/i], ['communication', /respond|response|reply|communicat|nobody|no one|ignored|unhelpful/i], ['listing accuracy', /photos?|pictures?|as described|advertis|misleading|not as|smaller|view/i], ['bed & linen', /bed|mattress|pillow|sheet|linen|towel/i]]
    const theme: Record<string, { n: number; units: Set<string>; q: string[] }> = {}
    for (const r of low) {
      const t = str(r.content)
      for (const [k, re] of THEMES) if (re.test(t)) { const e = theme[k] = theme[k] || { n: 0, units: new Set(), q: [] }; e.n++; e.units.add(nameOf(r.listing_id)); if (e.q.length < 2) e.q.push(`"${clip(t, 110)}" — ${nameOf(r.listing_id)}, ${norm5(r.rating)}★ ${str(r.channel)}`) }
    }
    const tt = Object.entries(theme).sort((a, b) => b[1].n - a[1].n).slice(0, 7)
    stats.reviews = { total: rows.length, shown: low.length }
    blocks.push(`## REVIEWS, ${days} days — ${rows.length} received, ${low.length} at 3★ or below\nBy building (received / low): ${Object.entries(byB).sort((a, b) => b[1].low - a[1].low).slice(0, 8).map(([b, e]) => `${b} ${e.n}/${e.low}`).join(' · ') || 'none'}\nLow-review themes (theme · low reviews mentioning it · distinct units · examples):\n` +
      (tt.map(([k, e]) => `- ${k} · ${e.n} · ${e.units.size} units\n  ${e.q.join('\n  ')}`).join('\n') || '- none'))
  } catch (e: any) { blocks.push(`## REVIEWS — unavailable (${clip(e?.message, 80)})`) }

  // 3. the crews
  try {
    const [cl, ins] = await Promise.all([crewScorecard({ role: 'clean', days: 60 }), crewScorecard({ role: 'inspect', days: 60 })])
    const line = (p: any) => `- ${p.person} · ${p.visits} visits · review ${p.reviewAvg != null ? p.reviewAvg + '/5 (n=' + p.reviewSample + ')' : 'no sample'} · catch ${Math.round(p.catchRate)}% · miss ${Math.round(p.missRate)}% · caught-not-fixed ${p.caughtNotFixed}${(p.flags || []).length ? ' · ' + p.flags.slice(0, 2).join('; ') : ''}`
    const worst = (r: any) => (r.people || []).filter((p: any) => p.visits >= 8).sort((a: any, b: any) => (b.missRate - a.missRate)).slice(0, 6)
    stats.crews = { total: (cl.people || []).length + (ins.people || []).length, shown: worst(cl).length + worst(ins).length }
    blocks.push(`## CREWS, 60 days (people with 8+ visits, highest miss rate first; "miss" = guest found something on day one that nobody reported; "caught-not-fixed" = they reported it and maintenance did not close it before the guest arrived — that is maintenance's failure, not theirs)\nCleaners (${cl.totals.visits} visits, ${cl.totals.caughtNotFixed} caught-not-fixed, ${cl.totals.guestFoundDayOne} day-one finds):\n${worst(cl).map(line).join('\n') || '- no sample'}\nInspectors (${ins.totals.visits} visits):\n${worst(ins).map(line).join('\n') || '- no sample'}\n${[...cl.caveats, ...ins.caveats].slice(0, 3).map(c => 'Caveat: ' + c).join('\n')}`)
  } catch (e: any) { blocks.push(`## CREWS — unavailable (${clip(e?.message, 80)})`) }

  // 4. bad-review inspections
  try {
    const { data } = await db.from('auto_inspections').select('reservation_id,listing_id,unit_name,reason,check_in,task_id,created_at').like('reservation_id', 'rev:%').gte('created_at', from60 + 'T00:00:00Z').limit(500)
    const rows = ((data || []) as any[])
    const ids = rows.map(r => str(r.task_id)).filter(Boolean)
    const tmap: Record<string, any> = {}
    if (ids.length) { const { data: ts } = await db.from('breezeway_tasks_sync').select('id,status,finished_at,scheduled_date').in('id', ids); for (const t of ((ts || []) as any[])) tmap[str(t.id)] = t }
    const walked = rows.filter(r => { const t = tmap[str(r.task_id)]; return t && (t.finished_at || /complet|finish|close|approv/i.test(str(t.status))) })
    const open = rows.filter(r => { const t = tmap[str(r.task_id)]; return t && !t.finished_at && !/complet|finish|close|approv|cancel/i.test(str(t.status)) })
    stats.walks = { total: rows.length, shown: open.length }
    blocks.push(`## BAD-REVIEW INSPECTIONS, 60 days — ${rows.length} raised, ${walked.length} walked, ${open.length} still open\nStill open (unit · reason · sits on):\n${open.slice(0, 8).map(r => `- ${r.unit_name} · ${r.reason} · ${str(tmap[str(r.task_id)]?.scheduled_date).slice(0, 10)}`).join('\n') || '- none'}`)
  } catch (e: any) { blocks.push(`## BAD-REVIEW INSPECTIONS — unavailable (${clip(e?.message, 80)})`) }

  // 5. unhappy guest threads
  try {
    const { data } = await db.from('guesty_conversation_sentiment').select('listing_id,dissatisfied,top_issue,band,last_message_at').gte('last_message_at', from30 + 'T00:00:00Z').eq('dissatisfied', true).limit(1000)
    const rows = ((data || []) as any[])
    const byB: Record<string, number> = {}, issues: Record<string, number> = {}
    for (const r of rows) { byB[bldOf(r.listing_id) || '?'] = (byB[bldOf(r.listing_id) || '?'] || 0) + 1; const i = clip(r.top_issue, 30).toLowerCase() || 'unspecified'; issues[i] = (issues[i] || 0) + 1 }
    stats.sentiment = { total: rows.length, shown: Math.min(8, rows.length) }
    blocks.push(`## UNHAPPY GUEST THREADS, 30 days — ${rows.length}\nBy building: ${Object.entries(byB).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([b, n]) => `${b} ${n}`).join(' · ') || 'none'}\nTop issues: ${Object.entries(issues).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([i, n]) => `${i} ${n}`).join(' · ') || 'none'}`)
  } catch (e: any) { blocks.push(`## UNHAPPY GUEST THREADS — unavailable (${clip(e?.message, 80)})`) }

  return { text: blocks.join('\n\n'), stats, today, from }
}

const SYSTEM = `You are Eve, the quality auditor for Stay Hospitality, a short-term rental operator in South Florida (~230 units, Miami and Broward, some buildings run by outside vendors). You read one evidence pack and name the THREE weaknesses most costing the company reviews and revenue right now.

RULES. Explain the numbers, never restate them. Reason from evidence to a root cause to one concrete action a named role can start this week. A weakness is REAL when the same thing shows up in more than one block (a unit on the glitch list AND in low reviews; a theme AND a crew number) or is concentrated somewhere (one building, one person, one category) — a portfolio-wide average is not a weakness. Say "no signal" for a block that is empty or too thin rather than inventing. Never blame a cleaner for something they reported and maintenance did not fix. Every finding names a metric from the allowed list and a direction; if nothing measurable would move, it is not a finding. Short: each field one or two sentences. Fewer than three findings is fine when the evidence only supports fewer.`

const SCHEMA = {
  type: 'object', required: ['headline', 'findings'],
  properties: {
    headline: { type: 'string', description: 'One sentence: the state of quality this week.' },
    findings: {
      type: 'array', maxItems: 3,
      items: {
        type: 'object', required: ['title', 'evidence', 'root_cause', 'action', 'owner', 'metric', 'expect_direction', 'scope'],
        properties: {
          title: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          root_cause: { type: 'string' }, action: { type: 'string' }, owner: { type: 'string', description: 'A role: maintenance lead, Broward supervisor, CCS, GM.' },
          metric: { type: 'string', enum: METRICS_ALLOWED as unknown as string[] }, expect_direction: { type: 'string', enum: ['up', 'down'] },
          expect_pct: { type: 'number', description: 'Expected % change in 21 days, if you can say.' },
          scope: { type: 'string', description: 'portfolio, a building name, or a person' },
        },
      },
    },
    no_signal: { type: 'array', items: { type: 'string' }, description: 'Blocks that were too thin to judge.' },
  },
}

export type QualityAudit = { ok: true; headline: string; findings: any[]; noSignal: string[]; filed: number; posted: string; model: string; pack: QualityPack['stats'] } | { ok: false; error: string; pack?: QualityPack['stats'] }

export async function runQualityAudit(opts: { by?: string; post?: boolean } = {}): Promise<QualityAudit> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const pack = await buildQualityPack(90)
  const { model, fallback } = await modelPairFor('eve-review')
  let parsed: any = null, answeredBy = model
  try {
    const r = await anthropicMessages(key, {
      model, max_tokens: 3000, system: SYSTEM,
      tools: [{ name: 'quality_findings', description: 'Deliver the three weaknesses as structured data.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'quality_findings' },
      messages: [{ role: 'user', content: `DATE: ${pack.today}. WINDOW: ${pack.from} → ${pack.today}.\n\nEVIDENCE PACK:\n\n${pack.text}` }],
    }, fallback, 'eve-review')
    answeredBy = r.model
    if (!r.ok) return { ok: false, error: clip(r.data?.error?.message, 200) || `model call failed (${r.status})`, pack: pack.stats }
    const toolUse = (r.data?.content || []).find((c: any) => c.type === 'tool_use' && c.input && typeof c.input === 'object')
    parsed = toolUse ? toolUse.input : null
    void usageOf(r.data)
  } catch (e: any) { return { ok: false, error: clip(e?.message || e, 200), pack: pack.stats } }
  if (!parsed || !Array.isArray(parsed.findings)) return { ok: false, error: 'model answer was not structured', pack: pack.stats }

  const findings = parsed.findings.slice(0, 3).map((f: any) => ({
    title: clip(f.title, 120), evidence: (Array.isArray(f.evidence) ? f.evidence : []).map((e: any) => clip(e, 220)).slice(0, 4),
    root_cause: clip(f.root_cause, 300), action: clip(f.action, 300), owner: clip(f.owner, 60),
    metric: (METRICS_ALLOWED as readonly string[]).includes(str(f.metric)) ? str(f.metric) as MetricKey : 'low_reviews',
    expect_direction: f.expect_direction === 'up' ? 'up' : 'down', expect_pct: Number.isFinite(Number(f.expect_pct)) ? Number(f.expect_pct) : undefined,
    scope: clip(f.scope, 80) || 'portfolio', recommendation_id: null as string | null,
  }))

  // File each as a plan the grader will measure.
  let filed = 0
  const recGate = await agentAllowed('recommendation')
  for (const f of (recGate.mode === 'observe' ? [] : findings)) {
    const detail = [`ROOT CAUSE: ${f.root_cause}`, `ACTION: ${f.action}`, `OWNER: ${f.owner}`, f.evidence.length ? `EVIDENCE:\n- ${f.evidence.join('\n- ')}` : ''].filter(Boolean).join('\n')
    const r = await createRecommendation({ title: f.title, detail, scope: f.scope, metric: f.metric, expect_direction: f.expect_direction, expect_pct: f.expect_pct, measure_in_days: 21, created_by: opts.by || 'quality-audit', source: 'quality-audit', kind: 'plan', area: 'quality' })
    if (r.ok) { filed++; f.recommendation_id = r.id || null }
  }

  // Say it in #leadership, short.
  let posted = 'skipped'
  if (opts.post !== false && findings.length) {
    const text = `*Quality this week* — ${clip(parsed.headline, 200)}\n` + findings.map((f: any, i: number) => `${i + 1}. *${f.title}* — ${f.root_cause} → ${f.action} (${f.owner}; watch ${lc(f.metric).replace(/_/g, ' ')} ${f.expect_direction})`).join('\n') + `\nFull evidence in Users & admin → Settings → Eve → Direction. Accept or reject each there; I grade them in 3 weeks.`
    const gate = await agentAllowed('slack_post', { ask: true })
    const r = await stepDown(gate, { action: 'slack_post', summary: `quality audit in #leadership (${findings.length} findings)`, exec: { channel: EVE_CHANNELS.leadership, channel_name: 'leadership', text }, by: opts.by || 'cron:quality-audit' },
      async () => { const p = await postToChannel(EVE_CHANNELS.leadership, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
    posted = r.mode + (r.ok ? '' : ` (${r.error || gate.reason})`)
  }
  return { ok: true, headline: clip(parsed.headline, 200), findings, noSignal: (Array.isArray(parsed.no_signal) ? parsed.no_signal : []).map((s: any) => clip(s, 80)), filed, posted, model: answeredBy, pack: pack.stats }
}

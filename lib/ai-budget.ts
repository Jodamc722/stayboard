// THE HARD STOP ON AI SPEND (Jon, 2026-10-07: "What is costing me so much money? I keep getting
// charged, need to put a hard stop on some things to stop the charges from coming in").
//
// Every Messages call goes through lib/ai-usage aiFetch, and every call is already priced into
// ai_usage. So the stop lives there: before a call goes out, today's spend (since midnight Eastern)
// is checked against two caps —
//   automaticUsd  background and automatic jobs (Slack reading, sentiment, learning, billing
//                 translation, the daily focus, HK damage…) stop here for the rest of the day
//   totalUsd      everything stops here, Eve's chat included
// and this month's spend against monthUsd (everything stops). A stopped call never reaches
// Anthropic: it comes back as a 429 with error.type 'budget_exceeded', which every caller already
// treats as "the AI didn't answer". Caps live in app_settings 'ai_budget'; spend is cached 60s.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting } from './app-settings'

// The caps, the lists and the decision live in lib/ai-budget-rules.ts — a file with no imports, so the
// rules are tested with plain numbers (lib/__tests__/ai-budget-rules.test.mjs). This file reads the
// ledger and the setting and asks it.
import { DEFAULT_BUDGET, NIGHTLY, decideBudget, type AiBudget, type SpendState } from './ai-budget-rules'
export { DEFAULT_BUDGET, INTERACTIVE, NEVER_CAPPED, WEEKLY_EXEMPT, NIGHTLY, AUTO_TWIN, decideBudget, nightlyAllowance } from './ai-budget-rules'
export type { AiBudget, SpendState, BudgetVerdict } from './ai-budget-rules'

const etMidnightIso = () => {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offset = now.getTime() - et.getTime()
  et.setHours(0, 0, 0, 0)
  return new Date(et.getTime() + offset).toISOString()
}
const monthStartIso = () => {
  const d = new Date(etMidnightIso()); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return new Date(d.getTime() - (et.getDate() - 1) * 86400000).toISOString()
}

let cache: ({ at: number } & SpendState) | null = null
async function hourCounts(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin().from('ai_usage').select('task').gte('at', new Date(Date.now() - 3600_000).toISOString()).limit(5000)
  const out: Record<string, number> = {}
  for (const r of (data || []) as any[]) out[r.task] = (out[r.task] || 0) + 1
  return out
}
/** Spend since `since`: the total, and the part of it the nightly learning jobs made (NIGHTLY). */
async function sum(since: string): Promise<{ total: number; nightly: number }> {
  const db = supabaseAdmin()
  let total = 0, nightly = 0
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db.from('ai_usage').select('task,cost_usd').gte('at', since).range(page * 1000, page * 1000 + 999)
    if (error || !data) break
    for (const r of data as any[]) {
      const usd = Number(r.cost_usd) || 0
      total += usd
      if (NIGHTLY.has(String(r.task || ''))) nightly += usd
    }
    if (data.length < 1000) break
  }
  return { total, nightly }
}
export async function spendNow(force = false): Promise<SpendState> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache
  const none = { total: 0, nightly: 0 }
  const [budget, day, month, hour] = await Promise.all([
    getSetting<Partial<AiBudget>>('ai_budget', {}).then(b => ({ ...DEFAULT_BUDGET, ...(b || {}) })).catch(() => DEFAULT_BUDGET),
    sum(etMidnightIso()).catch(() => none),
    sum(monthStartIso()).catch(() => none),
    hourCounts().catch(() => ({} as Record<string, number>)),
  ])
  cache = { at: Date.now(), day: day.total, month: month.total, budget, hour, nightly: day.nightly }
  return cache
}
/** Null when the call may go; otherwise why it may not. Never throws (a broken check lets the call through). */
export async function budgetBlock(task: string): Promise<string | null> {
  try {
    const s = await spendNow()
    // The manual Pause stops everything and warns nobody; every other state warns first (once a day each).
    if (!s.budget.paused) await warn(s).catch(() => {})
    const v = decideBudget(task, s)
    if (v.brake) {
      await warnOnce('brake:' + task, `AI brake: "${task}" stopped`, `It made ${v.brake.count} AI calls in the last hour (limit ${v.brake.limit}) — that looks like a loop, so it is paused for the hour. Everything else keeps working.`).catch(() => {})
    }
    return v.blocked
  } catch { return null }
}
export function bustBudgetCache() { cache = null }

// ── WARNINGS TO JON (2026-10-07: "warning to me") ─────────────────────────────────────────────────
// A bell in Lighthouse for every admin — never Slack or email. Each warning goes once a day:
// at 75% of the daily cap, when the daily cap stops AI, at 75% of the month, at the monthly stop,
// and whenever the runaway brake catches a feature.
const ET_DAY = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10)
let sentMemo: { day: string; keys: Set<string> } = { day: '', keys: new Set() }
async function warnOnce(key: string, title: string, body: string) {
  const day = ET_DAY()
  if (sentMemo.day !== day) sentMemo = { day, keys: new Set() }
  if (sentMemo.keys.has(key)) return
  sentMemo.keys.add(key)
  const { setSetting } = await import('./app-settings')
  const st = await getSetting<{ day?: string; sent?: string[] }>('ai_budget_alerts', {})
  const sent = st?.day === day && Array.isArray(st.sent) ? st.sent : []
  if (sent.includes(key)) return
  await setSetting('ai_budget_alerts', { day, sent: [...sent, key] }, 'ai-budget')
  const { data } = await supabaseAdmin().from('app_users').select('email,role,status').eq('role', 'admin')
  const to = ((data || []) as any[]).filter(u => String(u.status || 'active') === 'active').map(u => String(u.email || '').toLowerCase()).filter(Boolean)
  const { notify } = await import('./notify')
  await notify(to, { kind: 'ai_budget', title, body, link: '/users?tab=settings&panel=ai-models' })
}
async function warn(s: { day: number; month: number; budget: AiBudget }) {
  const b = s.budget
  if (b.paused || !b.on) return
  const $ = (n: number) => '$' + n.toFixed(2)
  if (s.month >= b.monthUsd) return warnOnce('month-stop', 'AI stopped — monthly budget reached', `${$(s.month)} spent this month (cap $${b.monthUsd}). Lighthouse AI is paused until the 1st. Raise the cap or press Pause in Settings → AI models.`)
  if (s.day >= b.totalUsd) return warnOnce('day-stop', 'AI stopped for today — daily budget reached', `${$(s.day)} spent today (cap $${b.totalUsd}). Lighthouse AI is paused until midnight.`)
  if (s.month >= b.monthUsd * 0.75) await warnOnce('month-75', 'AI spend at 75% of the month', `${$(s.month)} of $${b.monthUsd} this month.`)
  if (s.day >= b.totalUsd * 0.75) await warnOnce('day-75', 'AI spend at 75% of today’s cap', `${$(s.day)} of $${b.totalUsd} today. AI stops automatically at the cap — or press Pause in Settings → AI models.`)
}

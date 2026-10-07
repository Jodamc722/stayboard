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

export type AiBudget = {
  automaticUsd: number; totalUsd: number; monthUsd: number; on: boolean
  /** THE PAUSE BUTTON (Jon, 2026-10-07): true = no AI call leaves Lighthouse, whatever the spend. */
  paused: boolean
  /** THE RUNAWAY BRAKE: most calls one feature may make in an hour (Eve's chat gets 3x). The 10-07
   *  translate loop made ~284 calls in a day; nothing legitimate needs this many in an hour. */
  perTaskHour: number
}
export const DEFAULT_BUDGET: AiBudget = { automaticUsd: 5, totalUsd: 9, monthUsd: 250, on: true, paused: false, perTaskHour: 40 }
// Typed by a person, on the spot — the only calls that keep going after the automatic cap.
const INTERACTIVE = new Set(['eve', 'eve-vision', 'eve-investigate', 'listing-copy', 'review-reply', 'reports', 'guidebook', 'project-plan', 'expectations', 'guest-reply'])

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

let cache: { at: number; day: number; month: number; budget: AiBudget; hour: Record<string, number> } | null = null
async function hourCounts(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin().from('ai_usage').select('task').gte('at', new Date(Date.now() - 3600_000).toISOString()).limit(5000)
  const out: Record<string, number> = {}
  for (const r of (data || []) as any[]) out[r.task] = (out[r.task] || 0) + 1
  return out
}
async function sum(since: string): Promise<number> {
  const db = supabaseAdmin()
  let total = 0
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db.from('ai_usage').select('cost_usd').gte('at', since).range(page * 1000, page * 1000 + 999)
    if (error || !data) break
    for (const r of data as any[]) total += Number(r.cost_usd) || 0
    if (data.length < 1000) break
  }
  return total
}
export async function spendNow(force = false): Promise<{ day: number; month: number; budget: AiBudget; hour: Record<string, number> }> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache
  const [budget, day, month, hour] = await Promise.all([
    getSetting<Partial<AiBudget>>('ai_budget', {}).then(b => ({ ...DEFAULT_BUDGET, ...(b || {}) })).catch(() => DEFAULT_BUDGET),
    sum(etMidnightIso()).catch(() => 0),
    sum(monthStartIso()).catch(() => 0),
    hourCounts().catch(() => ({} as Record<string, number>)),
  ])
  cache = { at: Date.now(), day, month, budget, hour }
  return cache
}
/** Null when the call may go; otherwise why it may not. Never throws (a broken check lets the call through). */
export async function budgetBlock(task: string): Promise<string | null> {
  try {
    const s = await spendNow()
    const b = s.budget
    if (b.paused) return 'AI is paused in Lighthouse (Settings → AI models → Pause all AI).'
    await warn(s).catch(() => {})
    if (!b.on) return null
    if (s.month >= b.monthUsd) return `Lighthouse's monthly AI budget ($${b.monthUsd}) is used up — AI is paused until the 1st.`
    if (s.day >= b.totalUsd) return `Lighthouse's daily AI budget ($${b.totalUsd}) is used up — AI is paused until midnight.`
    if (!INTERACTIVE.has(task) && s.day >= b.automaticUsd) return `Automatic AI jobs hit today's $${b.automaticUsd} cap — paused until midnight.`
    const lim = (task === 'eve' ? 3 : 1) * (Number(b.perTaskHour) || 40)
    if ((s.hour[task] || 0) >= lim) {
      await warnOnce('brake:' + task, `AI brake: "${task}" stopped`, `It made ${s.hour[task]} AI calls in the last hour (limit ${lim}) — that looks like a loop, so it is paused for the hour. Everything else keeps working.`).catch(() => {})
      return `"${task}" made ${s.hour[task]} AI calls in the last hour — paused for the hour so a loop can't run up the bill.`
    }
    return null
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

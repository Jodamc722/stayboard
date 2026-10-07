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

export type AiBudget = { automaticUsd: number; totalUsd: number; monthUsd: number; on: boolean }
export const DEFAULT_BUDGET: AiBudget = { automaticUsd: 8, totalUsd: 15, monthUsd: 250, on: true }
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

let cache: { at: number; day: number; month: number; budget: AiBudget } | null = null
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
export async function spendNow(force = false): Promise<{ day: number; month: number; budget: AiBudget }> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache
  const [budget, day, month] = await Promise.all([
    getSetting<Partial<AiBudget>>('ai_budget', {}).then(b => ({ ...DEFAULT_BUDGET, ...(b || {}) })).catch(() => DEFAULT_BUDGET),
    sum(etMidnightIso()).catch(() => 0),
    sum(monthStartIso()).catch(() => 0),
  ])
  cache = { at: Date.now(), day, month, budget }
  return cache
}
/** Null when the call may go; otherwise why it may not. Never throws (a broken check lets the call through). */
export async function budgetBlock(task: string): Promise<string | null> {
  try {
    const s = await spendNow()
    const b = s.budget
    if (!b.on) return null
    if (s.month >= b.monthUsd) return `Lighthouse's monthly AI budget ($${b.monthUsd}) is used up — AI is paused until the 1st.`
    if (s.day >= b.totalUsd) return `Lighthouse's daily AI budget ($${b.totalUsd}) is used up — AI is paused until midnight.`
    if (!INTERACTIVE.has(task) && s.day >= b.automaticUsd) return `Automatic AI jobs hit today's $${b.automaticUsd} cap — paused until midnight.`
    return null
  } catch { return null }
}
export function bustBudgetCache() { cache = null }

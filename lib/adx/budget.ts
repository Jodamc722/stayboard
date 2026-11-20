// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// AD STUDIO'S OWN MONTHLY CAP. Every AI call the studio makes is already written to the app's usage ledger (ai_usage)
// and already passes the app-wide spend guard (lib/ai-budget, inside aiFetch). This adds one more line in front of the
// new engine's calls: the studio's tasks together (old script writer and AI images included) may spend
// ADX_MONTHLY_CAP_USD in a calendar month (Eastern time, like the app-wide budget). When it is reached the wizard
// says so plainly and offers the house design, which costs nothing.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ADX_MONTHLY_CAP_USD } from './composition'

/** The new engine's tasks (lib/ai-models AI_TASKS, lib/ai-budget-rules INTERACTIVE). */
export const ADX_TASKS = ['adx-concept', 'adx-copy', 'adx-compose'] as const
/** Everything that counts toward the studio's cap. */
const COUNTED = [...ADX_TASKS, 'ad-script', 'ad-image']

function monthStartIso(): string {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offset = now.getTime() - et.getTime()
  et.setDate(1); et.setHours(0, 0, 0, 0)
  return new Date(et.getTime() + offset).toISOString()
}
let cache: { at: number; usd: number } | null = null
/** What Ad Studio has spent on AI this month, from the ledger. */
export async function adxSpend(force = false): Promise<{ usd: number; cap: number; left: number }> {
  if (force || !cache || Date.now() - cache.at > 30_000) {
    let usd = 0
    try {
      const db = supabaseAdmin(), since = monthStartIso()
      for (let page = 0; page < 10; page++) {
        const { data, error } = await db.from('ai_usage').select('cost_usd').in('task', COUNTED).gte('at', since).range(page * 1000, page * 1000 + 999)
        if (error || !data) break
        for (const r of data as any[]) usd += Number(r.cost_usd) || 0
        if (data.length < 1000) break
      }
      cache = { at: Date.now(), usd }
    } catch { /* a ledger that cannot be read never blocks the studio by itself; the app-wide guard still applies */ }
  }
  const spent = cache ? cache.usd : 0
  return { usd: Math.round(spent * 100) / 100, cap: ADX_MONTHLY_CAP_USD, left: Math.max(0, Math.round((ADX_MONTHLY_CAP_USD - spent) * 100) / 100) }
}
/** Null when the studio may call a model; otherwise the sentence the wizard shows. */
export async function adxBudgetBlock(): Promise<string | null> {
  const s = await adxSpend()
  if (s.usd >= s.cap) return `Ad Studio has used its AI budget for this month ($${s.usd.toFixed(2)} of $${s.cap}). New designs start again on the 1st. You can still open the house design for this event and edit it — that costs nothing.`
  return null
}
export function bustAdxSpend() { cache = null }

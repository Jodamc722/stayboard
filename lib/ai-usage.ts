// THE AI USAGE LEDGER — every Messages API call in the app goes through `aiFetch`, which records
// what it cost (2026-09-18).
//
// Before this file, 32 routes and libs each called fetch('https://api.anthropic.com/v1/messages')
// on their own, and the only usage anyone could see was Eve's (eve_chats.usage). So a cost pass
// meant guessing from prompt sizes. Now each call writes one ai_usage row: task, model, the four
// token counts, and dollars at the registry price — and /users → AI models shows the bill by task,
// by day and by model, next to the tier switch that changes it.
//
// `aiFetch(task, init)` is a drop-in for `fetch(URL, init)`: same Response back, same retry loops
// around it untouched. The row is written BEFORE the Response is returned (a fire-and-forget
// promise can be frozen on Vercel once the handler resolves), capped at 2.5s and swallowed on
// error — a ledger hiccup never fails an AI feature.
import 'server-only'
import { MODEL_IDS, MODEL_PRICE, type ModelTier } from '@/lib/ai-models'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

const ID_TO_TIER: Record<string, ModelTier> = Object.fromEntries(
  (Object.keys(MODEL_IDS) as ModelTier[]).map(t => [MODEL_IDS[t], t]),
) as Record<string, ModelTier>

/** Which price row a model id bills at. Unknown ids (an old pinned alias) bill at the family's tier. */
export function tierOfModel(model: string): ModelTier {
  if (ID_TO_TIER[model]) return ID_TO_TIER[model]
  const m = String(model || '').toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 'fable'
  if (m.includes('opus')) return 'opus'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet-4')) return 'sonnet-prev'
  return 'sonnet'
}

/** Dollars for one call. Cache reads bill at 10% of input, cache writes at 125% (Anthropic's published ratios). */
export function costUsd(model: string, u: Usage): number {
  const p = MODEL_PRICE[tierOfModel(model)]
  const perM = (n: number, rate: number) => (n / 1_000_000) * rate
  return perM(u.input, p.in) + perM(u.output, p.out) + perM(u.cacheRead, p.in * 0.1) + perM(u.cacheWrite, p.in * 1.25)
}

export function usageOf(d: any): Usage {
  const u = d?.usage || {}
  return {
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    cacheRead: Number(u.cache_read_input_tokens) || 0,
    cacheWrite: Number(u.cache_creation_input_tokens) || 0,
  }
}

export type UsageRow = {
  task: string; model: string; usage: Usage; ms?: number; ok: boolean; status?: number; stopReason?: string | null; route?: string
}

/** Write one ledger row. Never throws; never takes longer than 2.5s. */
export async function recordUsage(row: UsageRow): Promise<void> {
  try {
    const insert = supabaseAdmin().from('ai_usage').insert({
      task: row.task,
      model: row.model,
      input_tokens: row.usage.input,
      output_tokens: row.usage.output,
      cache_read: row.usage.cacheRead,
      cache_write: row.usage.cacheWrite,
      cost_usd: Number(costUsd(row.model, row.usage).toFixed(6)),
      ms: row.ms ?? null,
      ok: row.ok,
      status: row.status ?? null,
      stop_reason: row.stopReason ?? null,
      route: row.route ?? null,
    })
    await Promise.race([insert, new Promise(res => setTimeout(res, 2500))])
  } catch { /* ledger is best-effort */ }
}

/** Best guess at the calling route from the stack, so the drill-down can say where a call came from. */
function callerRoute(): string | undefined {
  try {
    const lines = String(new Error().stack || '').split('\n')
    for (const l of lines) {
      const m = l.match(/\/(app\/api\/[^\s:)]+|lib\/[^\s:)]+)\.(?:ts|js)/)
      if (m && !m[1].endsWith('ai-usage') && !m[1].endsWith('anthropic-call')) return m[1].replace(/\/route$/, '')
    }
  } catch { /* fine */ }
  return undefined
}

/**
 * Drop-in for `fetch(ANTHROPIC_URL, init)`. Returns the same Response; the body is read from a
 * clone so the caller's `r.json()` still works. `task` is the AI_TASKS key the call runs under.
 */
export async function aiFetch(task: string, init: RequestInit): Promise<Response> {
  const t0 = Date.now()
  let bodyModel = ''
  try { bodyModel = String(JSON.parse(String(init.body || '{}'))?.model || '') } catch { /* streaming or non-JSON body */ }
  const r = await fetch(ANTHROPIC_URL, init)
  const ms = Date.now() - t0
  try {
    const ct = r.headers.get('content-type') || ''
    if (ct.includes('text/event-stream')) {
      // Streaming: the caller reads the stream; usage arrives in the final message_delta event and
      // is the caller's to record via recordUsage. We log the attempt with zero tokens so it shows.
      await recordUsage({ task, model: bodyModel, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms, ok: r.ok, status: r.status, route: callerRoute() })
      return r
    }
    const d: any = await r.clone().json().catch(() => null)
    const model = String(d?.model || bodyModel || '')
    await recordUsage({ task, model, usage: usageOf(d), ms, ok: r.ok, status: r.status, stopReason: d?.stop_reason ?? null, route: callerRoute() })
  } catch { /* never let the ledger break the call */ }
  return r
}

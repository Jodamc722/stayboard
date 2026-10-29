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

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; /** The part of cacheWrite written with a 1-hour TTL (priced 2x, not 1.25x). */ cacheWrite1h?: number }

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

/** What a cache read costs as a share of list input. 0.1x for most models; Anthropic prices it lower on
 *  the newest ones (Fable/Mythos 5.1 at 0.025x, Opus/Sonnet 5.5 at 0.05x) — the ledger was overstating
 *  those reads by 4x and 2x. */
export function cacheReadRate(model: string): number {
  const m = String(model || '').toLowerCase()
  if (/(fable|mythos)-5-1/.test(m)) return 0.025
  if (/(opus|sonnet)-5-5/.test(m)) return 0.05
  return 0.1
}

/** Dollars for one call. Cache writes at 125% of input (5-minute) or 200% (1-hour); reads per cacheReadRate. */
export function costUsd(model: string, u: Usage): number {
  const m = String(model || '').toLowerCase()
  // A call that fell back to the old Haiku bills at the old Haiku's price, not the tier's; the newest
  // Haiku charges 5x list on prompts over 100k tokens.
  const longHaiku = /haiku-5-5/.test(m) && (u.input + u.cacheRead + u.cacheWrite) > 100_000
  const p = /haiku-4/.test(m) ? { in: 1, out: 5 } : longHaiku ? { in: 0.5, out: 2.5 } : MODEL_PRICE[tierOfModel(model)]
  const perM = (n: number, rate: number) => (n / 1_000_000) * rate
  const w1h = Math.min(Number(u.cacheWrite1h) || 0, u.cacheWrite)
  return perM(u.input, p.in) + perM(u.output, p.out) + perM(u.cacheRead, p.in * cacheReadRate(model)) + perM(u.cacheWrite - w1h, p.in * 1.25) + perM(w1h, p.in * 2)
}

// AUTO-CACHE FOR REPEATED SYSTEM PROMPTS (cache pass 2026-10-29). Only Eve and four routes marked
// cache_control; the other ~60 call sites re-sent the same system prompt at list price every call —
// ops-focus re-sends ~6k tokens of fixed rules for each market in one run. A breakpoint is NOT added
// blindly: a write that nobody reads costs 25% MORE than no cache at all. It is added only when this
// process sent the byte-identical system prompt within the last 4.5 minutes, i.e. a loop or a burst
// is under way and the next call will read it. One-off calls and prompts with a date or a name baked
// in never repeat, so they never pay a write. Calls that already place their own breakpoints are left
// exactly as they are. Below the model's minimum cacheable length the API ignores the marker, so the
// gate also skips prompts too short to cache.
const recentSystems = new Map<string, number>()
function minCacheChars(model: string): number {
  const m = String(model || '').toLowerCase()
  if (/haiku-4/.test(m) || /opus-4-[56]/.test(m)) return 4096 * 3.5
  if (/opus-4-7|mythos-preview/.test(m)) return 2048 * 3.5
  if (/-5-1|-5-5|fable-5|mythos-5|opus-5(?!-)/.test(m)) return 512 * 3.5
  return 1024 * 3.5
}
function hashText(t: string): string {
  let h = 5381
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0
  return t.length + ':' + (h >>> 0).toString(36)
}
// NEW-MODEL REQUEST SHAPE (2026-10-29, Haiku tier moved 4.5 → 5.5). Haiku 5.5 rejects temperature,
// top_p, top_k and budgeted thinking with a 400, and thinks by default where 4.5 did not. The ~25 call
// sites on the haiku tier were written for 4.5, so the request is adapted here rather than in each:
// sampling params dropped, budgeted thinking made adaptive, and — where the caller asked for no
// thinking or said nothing — effort set low so the model answers quickly and cheaply, as 4.5 did.
// max_tokens gets a floor so a short cap cannot be spent on thinking before any text. Output is
// billed on what is generated, not on the cap, so the floor costs nothing. Callers already read
// content blocks by type (lib/anthropic-text), and the tier's fallback is the old Haiku.
export function adaptForModel(rawBody: string): string {
  try {
    const b = JSON.parse(rawBody)
    const model = String(b?.model || '')
    // Sampling params are refused by every model from the 5 generation on — not only Haiku 5.5. Seen
    // live 2026-10-29: /api/ai/polish sent temperature 0.2 to Sonnet 5, got a 400, and every polish
    // was quietly re-sent to the older, pricier Sonnet 4.6. Dropped here for all of them.
    const newGen = /(sonnet|opus|haiku)-5|fable|mythos/.test(model)
    if (!b || !newGen) return rawBody
    const out: any = { ...b }
    delete out.temperature; delete out.top_p; delete out.top_k
    if (!/haiku-5-5/.test(model)) return JSON.stringify(out)
    const t = out.thinking
    if (t && t.type === 'enabled') out.thinking = { type: 'adaptive' }
    if (t && t.type === 'disabled') delete out.thinking
    if (!out.thinking && !out.output_config?.effort) out.output_config = { ...(out.output_config || {}), effort: 'low' }
    if (Number(out.max_tokens) > 0 && Number(out.max_tokens) < 2048) out.max_tokens = 2048
    return JSON.stringify(out)
  } catch { return rawBody }
}

export function withAutoSystemCache(rawBody: string): string {
  try {
    if (rawBody.includes('"cache_control"')) return rawBody
    const b = JSON.parse(rawBody)
    if (!b || b.stream || b.system == null) return rawBody
    const blocks: any[] = typeof b.system === 'string' ? [{ type: 'text', text: b.system }] : Array.isArray(b.system) ? b.system : []
    const text = blocks.map(x => String(x?.text || '')).join('\n')
    const toolsText = Array.isArray(b.tools) ? JSON.stringify(b.tools) : ''
    if (!blocks.length || blocks[blocks.length - 1]?.type !== 'text' || (text.length + toolsText.length) < minCacheChars(String(b.model || ''))) return rawBody
    const now = Date.now()
    const key = String(b.model || '') + '|' + hashText(toolsText + '\u0000' + text)
    const seen = recentSystems.get(key)
    recentSystems.set(key, now)
    if (recentSystems.size > 300) {
      for (const [k, at] of Array.from(recentSystems.entries())) if (now - at > 270_000) recentSystems.delete(k)
    }
    if (!seen || now - seen > 270_000) return rawBody
    const out = blocks.slice()
    out[out.length - 1] = { ...out[out.length - 1], cache_control: { type: 'ephemeral' } }
    return JSON.stringify({ ...b, system: out })
  } catch { return rawBody }
}

export function usageOf(d: any): Usage {
  const u = d?.usage || {}
  return {
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    cacheRead: Number(u.cache_read_input_tokens) || 0,
    cacheWrite: Number(u.cache_creation_input_tokens) || 0,
    // The API breaks cache writes down by TTL when a 1h breakpoint is in play (cache_creation.*).
    cacheWrite1h: Number(u.cache_creation?.ephemeral_1h_input_tokens) || 0,
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
  // THE HARD STOP (lib/ai-budget): over today's or this month's cap, the call never leaves.
  const { budgetBlock } = await import('./ai-budget')
  const blocked = await budgetBlock(task)
  if (blocked) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'budget_exceeded', message: blocked } }), { status: 429, headers: { 'content-type': 'application/json' } })
  }
  if (typeof init.body === 'string') init = { ...init, body: withAutoSystemCache(adaptForModel(init.body)) }
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

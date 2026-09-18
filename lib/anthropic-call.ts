// ONE PLACE TO CALL THE MESSAGES API WITH A MODEL FALLBACK (2026-09-09).
//
// The cost pass moved the wording utilities from Opus to Sonnet 5 by alias. An alias the account
// cannot see comes back 404 (or 400 "model: …"), and a Polish button that fails is a worse outcome
// than a Polish button that costs 2.5x. So: try the model asked for; if the API says it does not
// know it, try the fallback once, and say which one answered.
import 'server-only'
import { aiFetch } from '@/lib/ai-usage'
export { textOf } from './anthropic-text'

export type AnthropicCall = { ok: boolean; status: number; data: any; model: string }

/** `task` is the AI_TASKS key the call is billed to in the usage ledger (lib/ai-usage). */
export async function anthropicMessages(key: string, body: Record<string, any>, fallbackModel = 'claude-sonnet-4-6', task = 'unknown'): Promise<AnthropicCall> {
  const call = async (model: string) => {
    const r = await aiFetch(task, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, model }),
    })
    const data: any = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, data, model }
  }
  const first = await call(String(body.model))
  const unknownModel = first.status === 404 || (first.status === 400 && /model/i.test(String(first.data?.error?.message || '')))
  if (!first.ok && unknownModel && fallbackModel && fallbackModel !== body.model) return call(fallbackModel)
  return first
}

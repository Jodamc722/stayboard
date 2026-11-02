// AD STUDIO — ask the model for JSON and get JSON back (2026-11-02). The planner once returned a reply
// with a broken array ("Expected ',' or ']'") and the whole step failed. Now: parse leniently, and if
// it still will not parse (or the reply was cut off), ask once more for the same answer as valid JSON.
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelFor } from '@/lib/ai-models'

/** Pull the outermost {...} and parse it, forgiving the usual slips (trailing commas, smart quotes as delimiters). */
export function looseJson(text: string): any | null {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  const raw = text.slice(a, b + 1)
  const tries = [
    raw,
    raw.replace(/,\s*([}\]])/g, '$1'),
    raw.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'),
  ]
  for (const t of tries) { try { return JSON.parse(t) } catch { /* next */ } }
  return null
}

export async function askJson(key: string, prompt: string, opts: { maxTokens: number; temperature: number }): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  const model = await modelFor('ad-script')
  const messages: any[] = [{ role: 'user', content: prompt }]
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await anthropicMessages(key, { model, max_tokens: opts.maxTokens + attempt * 2000, temperature: attempt ? 0.2 : opts.temperature, messages }, undefined, 'ad-script')
    if (!r.ok) return { ok: false, error: `The model said ${r.status}. Try again.` }
    const text = (r.data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join('')
    const cut = r.data?.stop_reason === 'max_tokens'
    const j = cut ? null : looseJson(text)
    if (j) return { ok: true, json: j }
    messages.push({ role: 'assistant', content: text || '(empty)' })
    messages.push({ role: 'user', content: (cut ? 'That reply was cut off. Give the same answer again, shorter, ' : 'That reply was not valid JSON. Give the same answer again ') + 'as ONLY valid JSON: double quotes, no trailing commas, no quotes inside strings left unescaped, nothing before or after.' })
  }
  return { ok: false, error: 'The answer came back garbled twice. Try again.' }
}

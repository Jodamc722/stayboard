// WHEN EVE ANSWERS IN SLACK, AND WHEN SHE ONLY TRANSLATES.
//
// Jon, 2026-09-22, three instructions given in a row that add up to one rule:
//   1. "Train Eve when tagged on a Spanish post so that she translates it to English
//      automatically in Slack. Make that a rule."
//   2. "If it's not a question, then Eve doesn't have to respond. And if they're asking Eve a
//      question, they need to tag Eve on the frontend. If Eve is tagged on the backend, she
//      doesn't have to respond."
//   3. "Then the reverse is true, if english and tag eve at end convert to spanish."
//
// SO THE POSITION OF THE TAG IS THE INSTRUCTION. Nothing else needs deciding:
//
//   "@Eve what's the status on 401?"   TAG AT THE FRONT -> a question for her -> she answers.
//   "Ya terminé el 401 @Eve"           TAG AT THE END   -> translate it -> English, nothing else.
//   "401 is finished, needs a check @Eve"  TAG AT THE END -> translate it -> Spanish.
//
// A tag at the end is the team asking the room to be able to read each other. The field crews
// write in Spanish, the office writes in English, and either one can now make their own message
// legible to the other by tagging Eve after it. She posts the translation and says nothing else:
// the moment she starts interpreting, the room is reading Eve's view of what somebody said
// instead of what they said.
//
// THIS RUNS BEFORE runEve, WHICH IS THE POINT. A tag at the end used to cost a full Eve turn --
// roughly 100k tokens of tool schemas, atlas and memories -- to produce an answer nobody asked
// for. Now it costs one Haiku call, and a message with nothing to translate costs nothing at all.
//
// THE LANGUAGE TEST IS A HEURISTIC ON PURPOSE. Asking a model "is this Spanish?" would be an extra
// call on every mention. This counts function words and Spanish-only characters instead, and is
// tuned to be slow to call something Spanish: a line has to read as properly Spanish, not merely
// contain "hola" or a unit name with an accent in it. When it cannot tell, Eve says nothing --
// a wrong guess posts a nonsense translation in front of the whole company.
import { aiFetch } from '@/lib/ai-usage'
import { modelFor } from '@/lib/ai-models'

export type Lang = 'es' | 'en'

/** Is the @mention the FIRST thing in the message? */
export function tagIsFront(rawText: string, botUserId: string): boolean {
  if (!botUserId) return true
  const t = String(rawText || '').trim()
  // Slack sometimes leads with a blockquote marker or stray punctuation; allow those through.
  const lead = t.replace(/^[>\s*_~`-]+/, '')
  return new RegExp(`^<@${botUserId}>`).test(lead)
}

// Function words common in Spanish and rare-to-absent in English operational chatter.
// Deliberately excludes what the two languages share or borrow (no, si, hotel, total, final).
const ES_WORDS = /\b(que|qué|para|pero|porque|cuando|cuándo|donde|dónde|como|cómo|esta|está|están|este|esto|esos|esas|con|del|los|las|una|unos|unas|por|muy|más|también|ya|todo|toda|todos|hay|hace|hacer|tiene|tienen|tengo|puedo|puede|pueden|necesito|necesita|gracias|favor|ahora|hoy|mañana|ayer|listo|lista|terminé|termino|terminado|limpieza|limpio|limpia|habitación|cuarto|unidad|llave|llaves|puerta|agua|luz|aire|cama|toalla|toallas|sábanas|revisar|revisé|arreglar|arreglado|problema|reporte|entrada|salida|huésped|huespedes|trabajo|equipo|edificio|piso)\b/gi
const ES_CHARS = /[ñ¿¡áéíóúü]/gi
// The English equivalent — function words that carry almost no Spanish traffic.
const EN_WORDS = /\b(the|and|is|are|was|were|will|would|should|have|has|had|this|that|these|those|with|from|about|there|their|they|them|what|when|where|which|been|being|done|doing|need|needs|needed|please|thanks|check|checked|clean|cleaned|ready|room|unit|guest|key|door|water|towel|towels|sheets|fixed|broken|today|tomorrow|yesterday|still|already|not|but|for|you|your)\b/gi

/**
 * Which language is this, if either? Returns null when the text is too short or too mixed to
 * call — and null means Eve stays quiet, which is always the safe answer.
 */
export function detectLang(text: string): Lang | null {
  const t = String(text || '').trim()
  if (t.length < 12) return null
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 3) return null
  const es = (t.match(ES_WORDS) || []).length
  const en = (t.match(EN_WORDS) || []).length
  const chars = (t.match(ES_CHARS) || []).length
  const esScore = es + (chars > 0 ? 1.5 : 0)
  // Spanish has to clear a real bar AND beat English; otherwise English has to clear its own.
  if (esScore >= 2 && esScore > en) return 'es'
  if (en >= 2 && en > esScore) return 'en'
  return null
}

const SYSTEM: Record<Lang, string> = {
  // `from` is the language of the message; we translate into the other one.
  es: 'You translate Spanish workplace messages into natural English for a property-management team in Miami.',
  en: 'You translate English workplace messages into natural Latin-American Spanish for a property-management field team in Miami.',
}

/**
 * A faithful translation into the other language, or null if the call fails.
 *
 * NOT a summary, NOT an answer. Whatever the message asks, this returns the message in the other
 * language and nothing more.
 */
export async function translate(text: string, from: Lang): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const model = await modelFor('translate')
    const r = await aiFetch('translate', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 700,
        system: SYSTEM[from] + ' Output ONLY the translation — no preamble, no quotes, no notes, no commentary, and never an answer to anything the message asks. Keep unit numbers, building names, people’s names and times exactly as written. Keep the line breaks. If a phrase is local slang, translate the meaning rather than the words.',
        messages: [{ role: 'user', content: String(text).slice(0, 4000) }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    const out = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
    return out || null
  } catch { return null }
}

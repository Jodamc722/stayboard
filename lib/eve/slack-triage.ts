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
// A TAG AT THE END ALWAYS TRANSLATES. Jon, 2026-09-22: "This should work regardless. As long as
// Eve is tagged at the very end of the message, then Eve translates it... This should work across
// all channels." The first cut of this gated on a local language heuristic and stayed SILENT when
// it could not tell -- which meant a real message could be tagged and get nothing back, with no
// way for anyone to know why. Silence is the worst failure here, because it is indistinguishable
// from Eve being broken.
//
// So the heuristic no longer decides WHETHER to translate, only which direction to suggest. The
// model does the detecting, and it is told that this team writes in two languages and only two
// (Jon, 2026-09-22: "Its only english and spanish"): Spanish becomes English, English becomes
// Spanish, anything else is left alone. The other thing skipped is a message with nothing in it
// to translate -- a bare link, a number, an emoji -- because there is no translation of "401".
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
 * Which language does this look like, if either? This is now only a HINT passed to the translator
 * so it starts in the right place; it no longer decides whether Eve responds at all. null means
 * "unsure", and the model resolves it.
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

/**
 * Is there anything here that CAN be translated? A bare link, a unit number, a lone emoji or a
 * bare "ok" has no translation, and posting one would be noise in a channel. Everything else goes
 * to the translator, whatever language it turns out to be.
 */
export function worthTranslating(text: string): boolean {
  // tsconfig targets ES5 here, so no /u flag and no \p{L}. Latin + the Spanish accented set is
  // exactly the alphabet this team writes in, which is all this check needs to count.
  const LETTER = /[A-Za-z\u00C0-\u024F]/
  const t = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')          // links
    .replace(/<[^>]*>/g, ' ')                  // leftover Slack entities
    .replace(/[\uD800-\uDFFF]./g, ' ')         // emoji and other surrogate pairs
    .trim()
  const letters = (t.match(new RegExp(LETTER.source, 'g')) || []).length
  const words = t.split(/\s+/).filter(w => LETTER.test(w))
  return letters >= 6 && words.length >= 2
}

const SYSTEM = [
  'You translate short workplace messages for a property-management team in Miami. The team writes in Spanish and in English and needs to read each other.',
  'THIS TEAM WRITES IN TWO LANGUAGES AND ONLY TWO: English and Spanish. Work out which of the two the message is in, then translate it the other way \u2014 Spanish becomes natural English, English becomes natural Latin-American Spanish. If the message is in neither of those two languages, return the single word SKIP rather than translating it.',
  'Output ONLY the translation \u2014 no preamble, no quotes, no language label, no notes, no commentary, and never an answer to anything the message asks, even if it is clearly a question.',
  'Keep unit numbers, building names, people\u2019s names, times and links exactly as written. Keep the line breaks. If a phrase is local slang, translate the meaning rather than the words.',
  'If the message is already in both languages, return just the half that is missing. If there is genuinely nothing to translate, return the single word SKIP.',
].join(' ')

/**
 * The message in the other language, or null if there is nothing to post.
 *
 * NOT a summary, NOT an answer. Whatever the message asks, this returns the message in the other
 * language and nothing more.
 */
export async function translate(text: string, hint: Lang | null): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const model = await modelFor('translate')
    const lead = hint === 'es' ? 'This looks like Spanish.\n\n'
      : hint === 'en' ? 'This looks like English.\n\n'
      : ''
    const r = await aiFetch('translate', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: 'user', content: lead + String(text).slice(0, 4000) }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    const out = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
    if (!out || /^SKIP\.?$/i.test(out)) return null
    return out
  } catch { return null }
}

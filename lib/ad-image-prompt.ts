// AI IMAGES FOR ADS — the prompt rules (2026-11-12, Jon: "we should have more imagery generations to highlight the
// events, things going on there, promotions of it and highlight book with us").
//
// Every AI image Ad Studio asks for is built here, so the rules cannot be skipped by a hand-written prompt:
//   - photorealistic editorial photography in Miami light;
//   - NO logos, trademarks, brand names, signs or text of any kind in the picture;
//   - NO event branding, stage designs or official structures — the vibe, described generically
//     ("a waterfront electronic music festival at night, lasers over the bay"), never the event's name;
//   - NO recognizable real people or celebrities, NO real artworks reproduced.
// Event NAMES belong only in our own headline overlay, as plain facts ("Ultra weekend · Mar 26–28"), never implying
// we are partners or sponsors (EVENT_NAME_NOTE is shown in the editor).
//
// Client-safe: the editor uses the same helpers to prefill the prompt box and to show the cost hint.
import type { AdScene } from './ad-engine'
import { MOMENTS, type Moment } from './marketing-calendar'
import { AREAS, THINGS_TO_DO, type ThingToDo } from './ad-places'

export type ImageShape = 'portrait' | 'square' | 'landscape'
export const IMAGE_MODEL = 'gpt-image-1'
/** Medium is the default tier: sharp enough for a phone-sized ad, a fraction of high's price. */
export const IMAGE_QUALITY = 'medium'
export const IMAGE_SIZE: Record<ImageShape, '1024x1536' | '1024x1024' | '1536x1024'> = { portrait: '1024x1536', square: '1024x1024', landscape: '1536x1024' }
export const IMAGE_WH: Record<ImageShape, [number, number]> = { portrait: [1024, 1536], square: [1024, 1024], landscape: [1536, 1024] }
export const AI_LICENSE = 'AI-generated for Stay Hospitality'
export const IMAGE_COST_HINT = 'about a few cents per image'
export const EVENT_NAME_NOTE = 'We can say the event\'s name and dates; we never use its logo or imply we\'re partners.'
export const AI_KEY_MISSING = 'Add OPENAI_API_KEY in Vercel to turn on AI images'

/** The picture shape that fits an ad format. */
export function shapeOfFormat(format: string): ImageShape {
  return format === '9:16' || format === '4:5' || format === 'letter' ? 'portrait' : format === '1:1' ? 'square' : 'landscape'
}

// ── cost ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// OpenAI list prices for gpt-image-1 (per 1M tokens): text in $5, image in $10, image out $40. A medium image is
// ~1056 output tokens square (~$0.042) and ~1584 portrait/landscape (~$0.063). When the API returns its usage we
// price that; when it does not, the fixed estimate per image below is logged instead.
export const IMAGE_PRICE_EST: Record<ImageShape, number> = { square: 0.042, portrait: 0.063, landscape: 0.063 }
export type ImageUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }
export function imageCostUsd(shape: ImageShape, n: number, usage?: ImageUsage | null): { usd: number; estimated: boolean } {
  const out = Number(usage?.output_tokens) || 0
  if (usage && out > 0) {
    const imgIn = Number(usage.input_tokens_details?.image_tokens) || 0
    const txtIn = Number(usage.input_tokens_details?.text_tokens) || Math.max(0, (Number(usage.input_tokens) || 0) - imgIn)
    return { usd: (txtIn * 5 + imgIn * 10 + out * 40) / 1_000_000, estimated: false }
  }
  return { usd: IMAGE_PRICE_EST[shape] * Math.max(1, n), estimated: true }
}

// ── names out ────────────────────────────────────────────────────────────────────────────────────────────────────
// Event, brand and venue names → a generic description of the same thing. Longest first, so "Ultra Music Festival"
// is replaced before "Ultra".
const GENERIC: [RegExp, string][] = [
  [/\bart\s*basel(\s+miami\s+beach)?\b/gi, 'a contemporary art fair'],
  [/\bbasel\b/gi, 'art fair'],
  [/\bultra(\s+music)?(\s+festival)?(?![-\w])/gi, 'an electronic music festival'],
  [/\b(formula\s*(1|one)|f1)(\s+miami)?(\s+grand\s+prix)?\b/gi, 'a motor race'],
  [/\bgrand\s+prix\b/gi, 'motor race'],
  [/\bmiami\s+open\b/gi, 'a tennis tournament'],
  [/\b(sobewff|south\s+beach\s+wine\s*(&|and)\s*food(\s+festival)?)\b/gi, 'a food and wine festival'],
  [/\b(miami|fort\s+lauderdale)\s+international\s+boat\s+show\b/gi, 'a yacht exhibition'],
  [/\bflibs\b/gi, 'a yacht exhibition'],
  [/\bboat\s+show\b/gi, 'yacht exhibition'],
  [/\b(miami\s+)?marathon\b/gi, 'a city marathon'],
  [/\b(hard\s+rock\s+stadium|kaseya\s+center|bayfront\s+park|wynwood\s+walls|bahia\s+mar)\b/gi, 'the venue'],
  [/\b(stay\s+hospitality|stay-hospitality\.com)/gi, ''],
  [/\b(airbnb|vrbo|booking\.com|expedia|marriott|blueground|instagram|tiktok|facebook|coca[- ]cola|red\s*bull|heineken|nike|adidas|rolex|ferrari|mercedes)\b/gi, ''],
  [/\b(logo|logos|trademark|branded|branding|official|sponsor(ed|s)?|partner(s)?|presented\s+by)\b/gi, ''],
]
/** The text with event, brand and venue names swapped for generic words, markup and dates removed. */
export function scrubNames(text: string): string {
  let t = String(text || '').replace(/\*\*/g, '').replace(/\\n|\n/g, ' ')
  for (const [re, to] of GENERIC) t = t.replace(re, to)
  // any other moment name on the calendar (holiday names are fine as words, but keep it generic anyway)
  for (const m of MOMENTS) if (m.event && m.name.length > 4) t = t.split(m.name).join('the event')
  t = t.replace(/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s*\d{1,2}(\s*[–-]\s*\d{1,2})?\b/gi, '')
  t = t.replace(/,(\s*,)+/g, ',').replace(/["“”]/g, '').replace(/\s+([,.;])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,.;·-]+|[\s,;·-]+$/g, '')
  return t.trim()
}

/** The prompt that goes to the image model: the scene's description (names scrubbed) wrapped in the house rules. */
export function buildImagePrompt(description: string, shape: ImageShape): string {
  const scene = scrubNames(description).slice(0, 900) || 'a sunny South Florida waterfront with palm trees and turquoise water'
  const frame = shape === 'portrait' ? 'a tall vertical 9:16 phone frame' : shape === 'square' ? 'a square frame' : 'a wide horizontal frame'
  return [
    `Photorealistic editorial travel photograph: ${scene}.`,
    `Style: natural Miami light — warm sun or glowing dusk, soft tropical haze, vivid but true colours; full-frame camera, shallow depth of field, magazine quality. Composed for ${frame}, with calm open space in the upper or lower third where a headline will be laid over.`,
    'Rules: no text, letters, numbers, signs, banners or captions anywhere in the image. No logos, trademarks, brand names or product branding. No event branding, stage designs, mascots or official structures — keep everything generic. No recognizable real people and no celebrities: any people are anonymous, small in the frame, seen from behind or softly out of focus. No reproductions of real artworks — any art shown is abstract and original. No watermarks.',
  ].join('\n')
}

/** The real place a scene names (Act 2), if any — by its name in the headline, line or sub. */
export function placeOfScene(s: Pick<AdScene, 'head' | 'sub' | 'vo' | 'items'>): ThingToDo | null {
  const txt = [s.head, s.sub, s.vo, (s.items || []).join(' ')].join(' ').replace(/\*\*/g, '').toLowerCase()
  for (const a of AREAS) for (const t of THINGS_TO_DO[a.key] || []) if (t.name.length > 5 && txt.includes(t.name.toLowerCase().replace(/^the /, ''))) return t
  return null
}

/** What the Generate box is prefilled with for a scene: its saved prompt, else the event's vibe (Act 1), the place's
 *  picture (Act 2), else the scene's own words with names scrubbed. Generic by construction. */
export function defaultImagePrompt(s: AdScene, m?: Moment | null, index = 0): string {
  if (s.imgPrompt && s.imgPrompt.trim()) return s.imgPrompt.trim()
  if (s.act === 'event' && m?.vibe?.length) return m.vibe[Math.min(index, m.vibe.length - 1)]
  const place = placeOfScene(s)
  if (place) return place.visual
  const words = scrubNames([s.head, s.sub].filter(Boolean).join(', '))
  return (words ? words + ' — ' : '') + 'South Florida, sunny, palm trees, inviting'
}

/** Stock-search words for a scene (the fallback when AI images are off). */
export function stockQueryOf(s: AdScene, m?: Moment | null): string {
  if (s.act === 'event' && m?.vibeStock) return m.vibeStock
  const place = placeOfScene(s)
  if (place) return place.stock
  const w = scrubNames([s.head, s.sub].join(' ')).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(x => x.length > 3).slice(0, 4).join(' ')
  return w || 'miami skyline'
}

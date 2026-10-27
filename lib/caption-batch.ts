// CAPTION EVERY PHOTO (Jon, 2026-10-27: "write captions for all photos. If unsure of bed size don't
// say it, if not sure if common area vs in-room just describe it").
//
// The batch writer behind /api/photos/captions: several photos per vision call, each answered with a
// caption AND two honesty flags — is the bed size certain, is it certain whether the space is inside
// the unit or a shared building area. A caption whose flag says "not sure" has the claim taken out
// here, in code, whatever the model wrote: "king bed" → "bed", "private balcony" → "balcony". The
// prompt asks for this; the sanitizer makes sure of it.
//
// Pure: no imports, no I/O. lib/__tests__/caption-batch.test.mjs runs the rules.

/** Jon's two rules, as the prompt states them. Also appended to every caption spec (lib/listing-ai). */
export const CERTAINTY_RULES = `CERTAINTY RULES — these override every other instruction, including any list of terms to use:
- Bed size: say king, queen, full, double or twin ONLY when the photo makes the size unmistakable. If there is any doubt, just say "bed" (or "bedroom") — never guess a size.
- Inside the unit or a shared building space: say "private", "in-unit", "shared", "building", "residents'" or "community" ONLY when the photo makes it unmistakable (a lobby desk, a building pool with many loungers, a balcony seen from the unit's own living room). If there is any doubt, just describe what is there — "Pool deck with loungers", "Fitness room with treadmills" — without saying whose it is.
- Never a claim the photo does not show.`

export type BatchItem = { i: number; context?: string }
export type BatchAnswer = { caption: string; bedSure: boolean; placeSure: boolean }

/** The user text for one vision call: one line per photo, then the reply format. */
export function batchInstruction(items: BatchItem[], listingLine: string): string {
  const lines = items.map(it => `Photo ${it.i}${it.context ? ' — ' + it.context : ''}`)
  return [
    listingLine,
    `There are ${items.length} photos below, in order. Write one caption for each.`,
    ...lines,
    `Reply with ONLY a JSON array, one object per photo, in the same order:`,
    `[{"i":1,"caption":"…","bedSure":false,"placeSure":false}]`,
    `bedSure = true only if your caption names a bed size AND the photo makes that size unmistakable. placeSure = true only if your caption says the space is private, in-unit, shared or the building's AND the photo makes that unmistakable.`,
  ].join('\n')
}

/** Read the model's reply. Tolerates a code fence or prose around the array; returns one answer per index, or null where missing. */
export function parseBatch(text: string, indices: number[]): (BatchAnswer | null)[] {
  const s = String(text || '')
  const a = s.indexOf('['), b = s.lastIndexOf(']')
  let arr: any[] = []
  if (a >= 0 && b > a) { try { const j = JSON.parse(s.slice(a, b + 1)); if (Array.isArray(j)) arr = j } catch { arr = [] } }
  const byI: Record<string, any> = {}
  arr.forEach((o, k) => { if (o && typeof o === 'object') { const key = Number.isFinite(Number(o.i)) ? String(Number(o.i)) : String(indices[k]); if (!(key in byI)) byI[key] = o } })
  return indices.map(i => {
    const o = byI[String(i)]
    if (!o || typeof o.caption !== 'string' || !o.caption.trim()) return null
    return { caption: o.caption, bedSure: o.bedSure === true, placeSure: o.placeSure === true }
  })
}

const BED_SIZE = /\b(california king|cal king|king|queen|full|double|twin)(?:[- ]size(?:d)?)?[ -](beds?|bedroom|suite)\b/gi
const BED_SIZE_PLURAL = /\b(two|2|three|3|four|4|a pair of)\s+(california king|cal king|king|queen|full|double|twin)(?:[- ]size(?:d)?)?\s+beds\b/gi
const PLACE_WORDS = /\b(private|in-unit|in unit|shared|communal|community|residents'?|the building's|building's|building)\s+(?=[a-z])/gi

/**
 * Take the uncertain claims out of a caption, tidy it, and keep it to the length cap.
 * Returns '' if nothing usable is left.
 */
export function sanitizeCaption(raw: string, flags: { bedSure: boolean; placeSure: boolean }, maxChars = 120): string {
  let c = String(raw || '').replace(/[\r\n]+/g, ' ').replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').replace(/\s+/g, ' ').trim()
  if (!flags.bedSure) {
    c = c.replace(BED_SIZE_PLURAL, (_m, n) => n + ' beds')
    c = c.replace(BED_SIZE, (_m, _size, noun) => noun.toLowerCase() === 'suite' ? 'bedroom suite' : noun)
  }
  if (!flags.placeSure) {
    // "Building pool" / "private balcony" / "shared gym" → "pool" / "balcony" / "gym". "The building's
    // rooftop pool" → "Rooftop pool". A standalone "building" noun ("Building exterior") is left alone.
    c = c.replace(PLACE_WORDS, (m, w, off, all) => {
      const word = String(w).toLowerCase()
      if (word === 'building') {
        const next = all.slice(off + m.length).split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '')
        return ['pool', 'gym', 'fitness', 'lobby', 'rooftop', 'amenity', 'amenities', 'lounge', 'terrace', 'courtyard', 'spa', 'sauna', 'deck'].indexOf(next) >= 0 ? '' : m
      }
      return ''
    })
  }
  c = c.replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[,.;:\s-]+/, '').trim()
  if (c) c = c.charAt(0).toUpperCase() + c.slice(1)
  c = c.replace(/[!]+/g, '').replace(/\.$/, '')
  if (c.length > maxChars) {
    const cut = c.slice(0, maxChars + 1)
    const sp = cut.lastIndexOf(' ')
    c = (sp > maxChars * 0.6 ? cut.slice(0, sp) : cut.slice(0, maxChars)).replace(/[,;:\s-]+$/, '')
  }
  return c
}

/** Split into chunks of n. */
export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let k = 0; k < xs.length; k += n) out.push(xs.slice(k, k + n))
  return out
}

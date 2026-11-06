// LISTING COPY: FIT THE LIMITS, CHECK THE FACTS (Jon, 2026-11-06: "the regenerate option breaks, says
// too many requests, gets things wrong, 500 character limit for summary"). Shared by the copy route
// (so every caller gets copy that already fits) and the regenerate push (a last check before Guesty).
//
// fitToCap   the summary is held to 500 characters by Airbnb and the model, asked for 470–500, lands
//            at 510–560 often enough that the push was refused. Cut at the last full sentence that
//            fits; a title is cut at the last whole word, never mid-word, never with an ellipsis.
// factIssues the rewrite may say "2-bedroom" for a studio or "sleeps 6" for a unit that sleeps 4.
//            Only explicit numbers are compared with the listing's own fields — nothing is guessed.

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
const num = (s: string) => WORDS[s.toLowerCase()] ?? Number(s)

/** The text, cut to fit `cap` characters: whole sentences for prose, whole words for a title. */
// The summary's required closing line (lib/listing-ai): kept whole when the body above it is cut.
const KEEP_END = /\n*\s*Please see Other things to note before booking\.?\s*$/i

export function fitToCap(text: string, cap: number | null | undefined, kind: 'prose' | 'title' = 'prose'): { text: string; cut: boolean } {
  const t = String(text || '').trim()
  if (!cap || t.length <= cap) return { text: t, cut: false }
  const end = kind === 'prose' ? t.match(KEEP_END) : null
  if (end && end.index! > 0) {
    const tail = end[0].replace(/^\s+/, '').trim(), sep = /\n/.test(end[0]) ? '\n\n' : ' '
    const body = fitToCap(t.slice(0, end.index).trim(), cap - tail.length - sep.length, 'prose')
    return { text: body.text + sep + tail, cut: true }
  }
  const head = t.slice(0, cap)
  if (kind === 'prose') {
    // The last sentence end that fits, if it keeps at least 60% of the room.
    const ends = Array.from(head.matchAll(/[.!?](?=\s|$)/g)).map(m => (m.index ?? 0) + 1)
    const last = ends.length ? ends[ends.length - 1] : 0
    if (last >= cap * 0.6) return { text: head.slice(0, last).trim(), cut: true }
  }
  const sp = head.lastIndexOf(' ')
  let out = (sp > cap * 0.5 ? head.slice(0, sp) : head).replace(/[\s,;:–—|·-]+$/, '').trim()
  if (kind === 'prose' && !/[.!?]$/.test(out)) out = out.slice(0, cap - 1) + '.'
  return { text: out, cut: true }
}

export type Facts = { bedrooms?: number | null; bathrooms?: number | null; sleeps?: number | null; roomType?: string | null }

/** Explicit numbers in the copy that disagree with the listing: bedrooms, bathrooms, guests. */
export function factIssues(text: string, f: Facts, where = 'The copy'): string[] {
  const t = String(text || '')
  const out = new Set<string>()
  const N = '(\\d+(?:\\.5)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)'
  // Guesty records a studio as 1 bedroom; the unit's room type or name ("STU", "Studio") says which it is.
  const studio = /\bstudio\b|\bstu\b/i.test(String(f.roomType || ''))
  const beds = f.bedrooms == null ? null : studio ? 0 : Number(f.bedrooms)
  if (beds != null) {
    for (const m of Array.from(t.matchAll(new RegExp(N + '[ \\t-]*(?:bedroom|bed room|br)\\b', 'gi')))) {
      const n = num(m[1]); if (n !== beds && !(studio && n <= 1)) out.add(`${where} says ${m[0].trim()}, but the unit has ${beds === 0 ? 'no separate bedroom (studio)' : beds + ' bedroom' + (beds === 1 ? '' : 's')}.`)
    }
    // Only "studio" said of the unit itself: not a yoga or fitness studio, not "two studio units" or
    // "studio bedroom" (Arya's combined suites, Capri 110's second bedroom).
    if (beds >= 1) {
      const claims = Array.from(t.matchAll(/(\b[\w-]+\s+)?studio\b(\s*-?\s*[\w-]+)?/gi)).filter(m => {
        const prev = String(m[1] || '').trim().toLowerCase(), next = String(m[2] || '').replace(/^[\s-]+/, '').toLowerCase()
        if (/^(yoga|fitness|wellness|art|arts|dance|pilates|recording|photo|music|tattoo|two|second|both|each|separate|connected|twin)$/.test(prev)) return false
        if (/^(units?|suites?|bedrooms?|rooms?|style|apartments|city|district|space|area|layout|setup)$/.test(next)) return false
        return true
      })
      if (claims.length) out.add(`${where} calls it a studio, but the unit has ${beds} bedroom${beds === 1 ? '' : 's'}.`)
    }
  }
  const baths = f.bathrooms == null ? null : Number(f.bathrooms)
  if (baths != null && baths > 0) {
    for (const m of Array.from(t.matchAll(new RegExp(N + '[ \\t-]*(full[ \\t]+)?(?:bathrooms?|baths?|ba)\\b', 'gi')))) {
      // "2 full bathrooms" on a 2.5-bath unit is right: full baths are the whole number.
      const n = num(m[1]); if (m[2] ? n !== Math.floor(baths) : Math.abs(n - baths) >= 0.5) out.add(`${where} says ${m[0].trim()}, but the unit has ${baths} bathroom${baths === 1 ? '' : 's'}.`)
    }
  }
  const sleeps = f.sleeps == null ? null : Number(f.sleeps)
  if (sleeps != null && sleeps > 0) {
    for (const m of Array.from(t.matchAll(new RegExp('(?:sleeps|up to|accommodates|room for|fits)\\s+' + N + '(?:\\s+(?:guests|people|adults))?', 'gi')))) {
      const n = num(m[1]); if (n > sleeps && /sleeps|guests|people|adults|accommodates/i.test(m[0])) out.add(`${where} says ${m[0].trim()}, but the unit sleeps ${sleeps}.`)
    }
    const said = Array.from(out).join(' ')
    for (const m of Array.from(t.matchAll(new RegExp(N + '\\s+(?:guests|people|adults)\\b', 'gi')))) {
      const n = num(m[1]); if (n > sleeps && !said.includes(m[0].trim())) out.add(`${where} says ${m[0].trim()}, but the unit sleeps ${sleeps}.`)
    }
  }
  return Array.from(out)
}

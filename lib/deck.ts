// ── THE STAY HOSPITALITY DECK ────────────────────────────────────────────────
// Jon, 2026-09-16: "a very distinct feel, kind of a Stay Hospitality deck that we can generate
// the reports and the onboarding decks on… professional, elegant, clean."
//
// One house style, defined once, used by every owner-facing document we generate. The owner
// onboarding renders on it today; the owner report moves onto it next, and the point of putting
// the numbers HERE rather than inside a component is that when it does, it inherits the system
// instead of re-deriving it by eye.
//
// THREE RULES THE SYSTEM ENFORCES
//
// 1. A FIXED CANVAS. Every slide is composed at 1120×630 and scaled to whatever box it lands
//    in — a card on the page, the full glass on a call, a PDF page. Composition never reflows,
//    so what is built is what is presented. It also makes "does this fit?" a question with an
//    answer, which is what stops a slide quietly clipping its last line.
// 2. ONE TYPE SCALE. Seven sizes, no others. Every time a component invented its own size the
//    document got louder and less certain of itself.
// 3. INK IS EARNED. Clay is for things you can click and for one 30px rule per slide. Headings
//    are ink, supporting copy is grey, and nothing is black-weight. Elegance here is mostly
//    restraint plus whitespace.
export const CANVAS = { w: 1120, h: 630, pad: 64, footGap: 44 } as const

/** Seven sizes. If a slide needs an eighth, the slide is wrong. */
export const TYPE = {
  display: { size: 62, line: 1.02, track: '-0.03em' },   // the cover, and only the cover
  title:   { size: 40, line: 1.12, track: '-0.022em' },  // one per slide
  lead:    { size: 20, line: 1.55, track: '-0.005em' },  // the sentence read aloud
  body:    { size: 16, line: 1.65, track: '0' },
  small:   { size: 13.5, line: 1.6, track: '0' },
  label:   { size: 12, line: 1.4, track: '0' },          // quiet grey furniture
  micro:   { size: 11.5, line: 1.3, track: '0.08em' },   // the footer only
} as const

/** 8pt rhythm. Slides use these and nothing between them. */
export const SPACE = { xs: 6, sm: 10, md: 16, lg: 24, xl: 34, xxl: 48 } as const

export const RADIUS = { slide: 16, card: 14, image: 10, pill: 999 } as const

/**
 * Colour ROLES, not colours — the concrete hex comes from the report's chosen theme, so a deck
 * can be run in Capri (the house default: bone, navy, clay) or any of the others without a
 * single component knowing which.
 */
export const ROLE = {
  /** headings and the statement's decisive numbers */
  ink: 'ink',
  /** paragraphs */
  body: 'body',
  /** furniture: labels, footers, captions, the second line of anything */
  quiet: 'muted',
  /** links, the title rule, one number per slide. Nothing else. */
  mark: 'accent',
  /** the dark slides that stop a deck reading as one long beige afternoon */
  ground: 'band',
} as const

/** Ink for the dark slides. Fixed, because they sit on the brand ground in every theme. */
export const ON_DARK = {
  ink: '#ffffff',
  body: 'rgba(255,255,255,0.86)',
  quiet: 'rgba(255,255,255,0.56)',
  rule: 'rgba(255,255,255,0.22)',
} as const

/**
 * How many dark slides a deck should carry. Two is punctuation; five is a different document.
 * The onboarding spends its two on "About Stay Hospitality" and "What we charge".
 */
export const DARK_BUDGET = 2

/** The one line of furniture every slide below the cover carries. */
export function footerRight(wordmark: string, n: number): string {
  return wordmark + ' · ' + String(n).padStart(2, '0')
}

/**
 * SLIDE TONES — what stops a deck reading as one long beige afternoon.
 *
 * Jon, 2026-09-16: "some of the other slides are just very generic… add more color… it needs to
 * feel more premium." Fifteen slides on one flat cream is the single biggest reason a deck reads
 * as a template. Premium hospitality decks are not more colourful — they are more *layered*:
 * the same small palette, laid on three grounds, in a deliberate order.
 *
 *   light — bone. The default. Reading slides.
 *   tint  — bone pulled a few percent toward the ink. Carries lists and supporting material,
 *           and separates two reading slides that would otherwise run together.
 *   dark  — the navy ground. Punctuation only: the brand slide and the money slide.
 *
 * The rule is rhythm, not decoration: never two darks in a row, never more than two lights
 * before a change. Tone is assigned per slide in the deck definition, so the running order can
 * be read at a glance and re-tuned in one place.
 */
export type SlideTone = 'light' | 'tint' | 'dark'

/** Blend two hex colours. `amt` is how much of `b` lands in `a`. */
export function blend(a: string, b: string, amt: number): string {
  const hex = (h: string) => {
    const x = h.replace('#', '')
    const n = parseInt(x.length === 3 ? x.split('').map(c => c + c).join('') : x.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = hex(a)
  const [r2, g2, b2] = hex(b)
  const m = (p: number, q: number) => Math.round(p + (q - p) * Math.max(0, Math.min(1, amt)))
  return '#' + [m(r1, r2), m(g1, g2), m(b1, b2)].map(v => v.toString(16).padStart(2, '0')).join('')
}

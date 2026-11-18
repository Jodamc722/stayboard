// THE BUILDING'S TYPEFACES, AS FACES WE CAN USE (Jon, 2026-11-18: "styles should pull font style … from their
// website"). A building's site names its fonts in its CSS. Some are Google Fonts and can be used as they are.
// Most luxury sites license theirs (Canela, Didot, Gotham, Futura): those cannot be loaded on a deck, so each is
// matched to the closest free face, and the deck says which was matched to which. Isomorphic, no I/O.

/** Google families a deck can load, by lower-case name. Display serifs first, then sans. */
const GOOGLE: string[] = ['Cormorant Garamond', 'Cormorant', 'Playfair Display', 'Bodoni Moda', 'DM Serif Display', 'Fraunces', 'Instrument Serif', 'Libre Baskerville', 'Libre Caslon Text', 'EB Garamond', 'Lora', 'Crimson Pro', 'Crimson Text', 'Newsreader',
  'Source Serif 4', 'Merriweather', 'Prata', 'Gilda Display', 'Italiana', 'Marcellus', 'Cinzel', 'Tenor Sans', 'Noto Serif Display', 'Spectral', 'Bitter', 'PT Serif', 'Old Standard TT', 'Abril Fatface', 'Gloock', 'Young Serif',
  'Jost', 'Montserrat', 'Inter', 'Manrope', 'Outfit', 'Poppins', 'Raleway', 'Lato', 'Josefin Sans', 'Nunito Sans', 'Work Sans', 'DM Sans', 'Figtree', 'Plus Jakarta Sans', 'Syne', 'Archivo', 'Open Sans', 'Roboto', 'Mulish', 'Urbanist',
  'Red Hat Display', 'Sora', 'Lexend', 'Karla', 'Rubik', 'Barlow', 'Oswald', 'Bebas Neue', 'Space Grotesk', 'Albert Sans', 'Hanken Grotesk', 'Geist', 'Questrial', 'Quicksand', 'Cabin', 'Libre Franklin', 'Public Sans', 'IBM Plex Sans']
const G = new Map(GOOGLE.map(f => [f.toLowerCase(), f] as [string, string]))

/** A licensed face → the closest free one. Checked in order; the first pattern that matches wins. */
const CLOSEST: [RegExp, string][] = [
  [/canela|ogg|editorial new|saol|domaine|noe display|romana|recoleta|gt super|freight big|ivy ?(mode|presto)|larken|reckless/, 'Fraunces'],
  [/didot|bodoni|chronicle display|butler|playfair/, 'Bodoni Moda'],
  [/garamond|sabon|caslon|minion|sainte colombe|jenson|bembo|goudy|cormorant|portrait|lyon|tiempos headline|kepler/, 'Cormorant Garamond'],
  [/baskerville|mrs eaves|chronicle|times|tiempos|georgia|plantin|lora|source serif|publico|miller/, 'Libre Baskerville'],
  [/trajan|cinzel|optima|albertus|engravers/, 'Cinzel'],
  [/futura|century gothic|avant ?garde|brandon|twentieth century|tw cen|europa|neutra|kabel|josefin|jost/, 'Jost'],
  [/gotham|proxima|montserrat|metropolis|gilroy|sofia|museo sans|axiforma|nexa|campton/, 'Montserrat'],
  [/avenir|nunito|gill sans|frutiger|myriad|whitney|ideal sans|seravek/, 'Nunito Sans'],
  [/circular|cera|euclid|sharp grotesk|basis grotesque|gt walsheim|apercu|maison neue|manrope|soehne|söhne|untitled sans/, 'Manrope'],
  [/helvetica|neue haas|akzidenz|aktiv|graphik|suisse|univers|arial|sf pro|inter\b|system-ui|segoe|roboto|neue montreal|founders grotesk/, 'Inter'],
  [/din\b|din |bebas|oswald|knockout|tungsten|druk|barlow condensed|league gothic/, 'Oswald'],
]
const GENERIC = /^(serif|sans-serif|system-ui|ui-sans-serif|ui-serif|monospace|cursive|fantasy|inherit|initial|unset|-apple-system|blinkmacsystemfont|var\(.*)$/i
const ICONISH = /icon|awesome|glyph|symbol|swiper|slick|dashicons|material|eicons|elementor|fontello|icomoon|emoji|mono\b|courier|consolas|menlo/i
const SERIF_HINT = /serif|garamond|caslon|baskerville|bodoni|didot|playfair|cormorant|canela|times|georgia|display|roman|chronicle|tiempos|minion|sabon/i

export type BrandFont = { /** what the site calls it */ site: string; /** the Google face a deck loads */ use: string; /** true when `use` is the site's own face, not a stand-in */ exact: boolean }
const names = (stack: string) => String(stack || '').replace(/!important/gi, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean)
/** One font-family stack → a face we can load, or null when it names nothing usable. */
export function resolveFont(stack: string, want: 'display' | 'text'): BrandFont | null {
  const list = names(stack).filter(n => !ICONISH.test(n))
  const first = list.find(n => !GENERIC.test(n))
  if (!first) return null
  const key = first.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+(regular|book|light|medium|bold|semibold|roman|web|pro|std|lt|text|display)$/i, m => (/display/i.test(m) ? m : '')).trim()
  const g = G.get(first.toLowerCase()) || G.get(key)
  if (g) return { site: first, use: g, exact: true }
  for (const [re, use] of CLOSEST) if (re.test(key)) return { site: first, use, exact: false }
  // an unknown name: go by the stack's own generic family, else by what it sounds like
  const serif = list.some(n => /^serif$/i.test(n)) || (!list.some(n => /^sans-serif$/i.test(n)) && SERIF_HINT.test(key))
  return { site: first, use: serif ? (want === 'display' ? 'Cormorant Garamond' : 'Newsreader') : (want === 'display' ? 'Jost' : 'Inter'), exact: false }
}

/** The headline face and the text face a site uses, read from its CSS (and the Google Fonts it links). */
export function fontsFromCss(css: string, googleFamilies: string[] = []): { display: BrandFont | null; text: BrandFont | null } {
  const stacks = (re: RegExp) => Array.from(css.matchAll(re)).map(m => m[1]).filter(Boolean)
  // headings: h1-h3 and the usual heading classes and custom properties
  const head = [
    ...stacks(/--[a-z0-9-]*(?:heading|headline|display|title|serif)[a-z0-9-]*\s*:\s*([^;}{]+)[;}]/gi).filter(v => /[a-z]/i.test(v) && !/^\s*[\d.#]/.test(v)),
    ...stacks(/(?:^|[},\s])(?:h1|h2|h3|\.h1|\.h2|\.heading|\.headline|\.title|\.display)\b[^{}]*\{[^}]*?font-family\s*:\s*([^;}]+)/gi),
  ]
  const text = [
    ...stacks(/--[a-z0-9-]*(?:body|text|base|sans|paragraph)[a-z0-9-]*font[a-z0-9-]*\s*:\s*([^;}{]+)[;}]/gi),
    ...stacks(/--[a-z0-9-]*font[a-z0-9-]*(?:body|text|base|sans|paragraph)[a-z0-9-]*\s*:\s*([^;}{]+)[;}]/gi),
    ...stacks(/(?:^|[},\s])(?:body|html|p)\b[^{}]*\{[^}]*?font-family\s*:\s*([^;}]+)/gi),
  ]
  const faces = stacks(/@font-face\s*\{[^}]*?font-family\s*:\s*([^;}]+)/gi)
  const pick = (cands: string[], want: 'display' | 'text') => { for (const c of cands) { const r = resolveFont(c, want); if (r) return r } return null }
  let display = pick(head, 'display'), body = pick(text, 'text')
  // nothing on the headings: a serif the site loads from Google, else the first face it declares
  const gSerif = googleFamilies.find(f => SERIF_HINT.test(f)), gAny = googleFamilies[0]
  if (!display) display = pick([gSerif || '', ...faces.filter(f => SERIF_HINT.test(f)), gAny || '', ...faces].filter(Boolean), 'display')
  if (!body) body = pick([googleFamilies.find(f => !SERIF_HINT.test(f)) || '', ...faces.filter(f => !SERIF_HINT.test(f))].filter(Boolean), 'text')
  if (display && body && display.use === body.use) body = null
  return { display, text: body }
}
/** Weights known to exist for the faces a stand-in can be. Any other face loads at its regular weight: asking
 *  Google for a weight a family lacks fails the whole stylesheet. */
const WEIGHTS: Record<string, string> = { 'Cormorant Garamond': '400;500;600;700', 'Fraunces': '400;500;600;700', 'Bodoni Moda': '400;500;600;700', 'Libre Baskerville': '400;700', 'Cinzel': '400;500;600;700',
  'Jost': '400;500;600;700', 'Montserrat': '400;500;600;700', 'Nunito Sans': '400;600;700', 'Manrope': '400;500;600;700', 'Inter': '400;500;600;700', 'Oswald': '400;500;600;700', 'Playfair Display': '400;500;600;700', 'Newsreader': '400;500;600' }
/** The Google Fonts stylesheet for a face. */
export const googleHref = (face: string) => 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(face).replace(/%20/g, '+') + (WEIGHTS[face] ? ':wght@' + WEIGHTS[face] : '') + '&display=swap'
/** True for a face this file knows Google serves (so a saved deck can only ever load one of ours). */
export const isGoogleFace = (face: string) => G.has(String(face || '').toLowerCase())

/** #rrggbb contrast against white, 1 to 21. */
function onWhite(hexc: string): number {
  const m = String(hexc || '').match(/^#([0-9a-f]{6})$/i); if (!m) return 1
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}
/** THE SAME LOOK ON THE SLIDES. A brand read makes a magazine theme (navy, sand, display, sans); this is that look
 *  as the presentation's style overrides (components/ReportView content.style): the dark colour for the bands, the
 *  accent where it is readable (else the dark colour), and the building's typefaces. */
export function slideStyleFromTheme(theme: any): { accent?: string; band?: string; font?: 'brand'; brandFont?: { display: string; text?: string } } {
  const t = theme || {}, ok = (c: any) => /^#[0-9a-f]{6}$/i.test(String(c || ''))
  const out: any = {}
  if (ok(t.navy)) out.band = String(t.navy)
  if (ok(t.sand)) out.accent = onWhite(t.sand) >= 3 ? String(t.sand) : ok(t.navy) ? String(t.navy) : undefined
  if (t.display && isGoogleFace(t.display)) { out.font = 'brand'; out.brandFont = { display: G.get(String(t.display).toLowerCase())!, ...(t.sans && isGoogleFace(t.sans) ? { text: G.get(String(t.sans).toLowerCase())! } : {}) } }
  return out
}
/** One stylesheet for a headline face and, when there is one, a text face. */
export const googleHrefPair = (display: string, text?: string) => 'https://fonts.googleapis.com/css2?' + [display, text].filter(Boolean).map(f => 'family=' + encodeURIComponent(f as string).replace(/%20/g, '+') + (WEIGHTS[f as string] ? ':wght@' + WEIGHTS[f as string] : '')).join('&') + '&display=swap'
const SERIFISH = /serif|garamond|baskerville|bodoni|playfair|cormorant|fraunces|caslon|lora|crimson|newsreader|prata|gilda|italiana|marcellus|cinzel|spectral|bitter|gloock|abril|old standard/i
/** A CSS font stack for one of our faces. */
export const faceStack = (face: string) => `'${face}', ` + (SERIFISH.test(face) ? "Georgia, 'Times New Roman', serif" : 'ui-sans-serif, system-ui, -apple-system, sans-serif')

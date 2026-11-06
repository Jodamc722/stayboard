// GUIDEBOOK COLOUR THEMES (Jon, 2026-11-06: "we should have more color theme options, smart themes too
// for the property, locations and vibe" → "Build them all").
//
// Every theme is a full palette for the guest guide (GuideMobile) and the magazine book (GuidebookView):
// page, card, ink, muted ink, accent, hairline, tint and the cover's fallback colour. The two original
// themes keep their ids and exact colours ('editorial' = Coastal editorial, 'dark' = Dark luxe), so a
// book saved before this change looks the same until someone picks something else.
//
// 'smart' is not a palette: it is resolved per book from the property (building), the location (the
// city in the address) and the vibe of the listing title — Surfside reads as ocean, Botanica as garden,
// the Elser as downtown, 17 West as Miami deco — see smartThemeId(). Printing is always black on white.

export type GuideTheme = {
  id: string
  label: string
  vibe: string
  dark: boolean
  paper: string; card: string; ink: string; mute: string; accent: string; line: string; tint: string
  cover: string     // behind the cover photo (and the whole cover when there is no photo)
  swatch: [string, string, string]
}

const rgba = (hex: string, a: number) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}
function light(id: string, label: string, vibe: string, paper: string, ink: string, accent: string, cover: string): GuideTheme {
  return { id, label, vibe, dark: false, paper, card: '#ffffff', ink, mute: rgba(ink, 0.62), accent, line: rgba(ink, 0.08), tint: rgba(accent, 0.1), cover, swatch: [paper, accent, ink] }
}
function dark(id: string, label: string, vibe: string, paper: string, card: string, ink: string, accent: string, cover: string): GuideTheme {
  return { id, label, vibe, dark: true, paper, card, ink, mute: rgba(ink, 0.64), accent, line: rgba(ink, 0.1), tint: rgba(accent, 0.13), cover, swatch: [paper, accent, ink] }
}

export const GUIDE_THEMES: GuideTheme[] = [
  // The originals — unchanged colours.
  { ...light('editorial', 'Coastal editorial', 'Warm neutral, quiet luxury', '#f7f4ee', '#1f1d1a', '#8a7350', '#1c1a17'), tint: 'rgba(138,115,80,0.09)' },
  { ...dark('dark', 'Dark luxe', 'Evening, high-end, penthouse', '#141311', '#1d1b18', '#efeae2', '#c9a96a', '#1c1a17'), tint: 'rgba(201,169,106,0.12)' },
  // New
  light('ocean', 'Ocean breeze', 'Beachfront, steps to the sand', '#f1f6f7', '#123b4a', '#2e8b8b', '#0b2630'),
  light('sand', 'Sand dune', 'Easy beach town, sun-bleached', '#f8f3ea', '#3a2f24', '#c08a4a', '#2c241b'),
  light('palm', 'Tropical palm', 'Lush, pool, island feel', '#f2f6ef', '#1d3326', '#3f8a5a', '#14261b'),
  light('sunset', 'Sunset coral', 'Fun, lively, beach-bar energy', '#fbf3ef', '#3b2420', '#e0674f', '#2b1a17'),
  light('deco', 'Miami deco', 'South Beach pastel, art deco', '#fbf4f4', '#26303a', '#d9708f', '#1e2a33'),
  light('garden', 'Garden sage', 'Calm, green, resort garden', '#f3f5ef', '#2a3227', '#6f8a5c', '#20281d'),
  light('nautical', 'Nautical', 'Waterway, marina, Las Olas', '#f3f5f9', '#14233b', '#c7a14a', '#0f1a2c'),
  light('terracotta', 'Terracotta', 'Mediterranean, historic, artsy', '#f9f2ec', '#38251c', '#b5583a', '#2a1b14'),
  light('urban', 'Downtown slate', 'City, skyline, modern', '#f2f3f4', '#1c2127', '#4a6c8c', '#15191e'),
  dark('midnight', 'Midnight ocean', 'Oceanfront at night, moody', '#0e1820', '#16232d', '#e8eef2', '#6fb6c4', '#0b141b'),
  dark('spa', 'Spa retreat', 'Wellness, resort, slow mornings', '#171a17', '#202420', '#ece9e1', '#a9b89a', '#121512'),
]

export const SMART = 'smart'
export const THEME_CHOICES: { id: string; label: string }[] = [{ id: SMART, label: 'Smart — picked for the property' }, ...GUIDE_THEMES.map(t => ({ id: t.id, label: t.label }))]

export function themeById(id?: string | null): GuideTheme {
  return GUIDE_THEMES.find(t => t.id === id) || GUIDE_THEMES[0]
}

// Property → theme. Matched against the building, the nickname, the listing title and the address.
const BY_PROPERTY: [RegExp, string, string][] = [
  [/surfside|boynton/i, 'ocean', 'Surfside, Boynton Beach — steps to the ocean'],
  [/botanica|garden hotel/i, 'garden', 'Botanica — the Garden Hotel grounds'],
  [/\belser\b/i, 'urban', 'The Elser — downtown Miami on the bay'],
  [/17\s*w(est)?\b/i, 'deco', '17 West — South Beach'],
  [/\bar[iy]a\b|mr\.?\s*c\b/i, 'palm', 'Arya — Coconut Grove'],
  [/\beden\b/i, 'sunset', 'Eden — Fort Lauderdale beach'],
  [/hendricks|las olas|rustic|rio vista/i, 'nautical', 'On the Fort Lauderdale waterways'],
  [/\bamrit\b/i, 'spa', 'Amrit — wellness resort'],
  [/capri|lucerne|lake worth/i, 'terracotta', 'Lake Worth Beach — historic and artsy'],
  [/pelican|waves|pompano/i, 'sand', 'Pompano Beach'],
]
// City → theme (from the address), then the vibe of the title.
const BY_CITY: [RegExp, string, string][] = [
  [/miami beach|south beach/i, 'deco', 'Miami Beach'],
  [/coconut grove/i, 'palm', 'Coconut Grove'],
  [/brickell|downtown|miami\b/i, 'urban', 'Miami'],
  [/fort lauderdale|ft\.? lauderdale/i, 'nautical', 'Fort Lauderdale'],
  [/delray|boca|boynton|singer island|palm beach|jupiter/i, 'ocean', 'Palm Beach coast'],
  [/pompano|deerfield|hollywood|dania/i, 'sand', 'Broward beach towns'],
  [/lake worth|lantana/i, 'terracotta', 'Lake Worth'],
]
const BY_VIBE: [RegExp, string, string][] = [
  [/penthouse|luxury|luxe|skyline view/i, 'dark', 'Luxury listing'],
  [/spa|wellness|retreat/i, 'spa', 'Retreat'],
  [/oceanfront|ocean ?view|beachfront|walk to (the )?(beach|ocean)|beach/i, 'ocean', 'Beach stay'],
  [/tropical|pool|palm|island/i, 'palm', 'Tropical'],
  [/garden|courtyard/i, 'garden', 'Garden'],
  [/marina|canal|waterfront|intracoastal|boat/i, 'nautical', 'Waterfront'],
  [/downtown|city|loft|urban/i, 'urban', 'City'],
  [/art|historic|bungalow/i, 'terracotta', 'Historic'],
]

export type SmartCtx = { building?: string | null; nickname?: string | null; title?: string | null; address?: string | null }

/** The smart pick and the reason, for the editor ("Smart → Ocean breeze · Surfside, Boynton Beach"). */
export function smartTheme(ctx: SmartCtx): { id: string; why: string } {
  const prop = [ctx.building, ctx.nickname, ctx.title].filter(Boolean).join(' ')
  for (const [re, id, why] of BY_PROPERTY) if (re.test(prop)) return { id, why }
  const addr = String(ctx.address || '')
  for (const [re, id, why] of BY_CITY) if (re.test(addr)) return { id, why }
  const title = String(ctx.title || '')
  for (const [re, id, why] of BY_VIBE) if (re.test(title)) return { id, why }
  return { id: 'editorial', why: 'No strong signal — the house style' }
}

/** What a guidebook row looks like: the saved theme, with 'smart' resolved from the book (+ listing when known). */
export function themeForBook(gb: any, listing?: { building?: string | null; nickname?: string | null } | null): GuideTheme & { smart?: { id: string; why: string } } {
  const saved = String(gb?.theme || '')
  if (saved !== SMART) return themeById(saved)
  const s = gb?.sections || {}
  const address = typeof s.guidelines?.address === 'string' ? s.guidelines.address : ''
  const pick = smartTheme({ building: listing?.building || gb?._building, nickname: listing?.nickname || gb?._nickname, title: [gb?.listing_name, gb?.title].filter(Boolean).join(' '), address })
  return { ...themeById(pick.id), smart: pick }
}

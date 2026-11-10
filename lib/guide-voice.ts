// WHO SPEAKS IN A GUIDEBOOK (Jon, 2026-11-06 / 2026-11-10). One place decides the sign-off and the
// "your host" wording for every guest-facing version: the digital guide (GuideMobile), the magazine
// (GuidebookView), the 1-pager (GuideFlyer) and the FAQ.
//
// HOUSE RULE: the Boynton Beach property ("Surfside" — building / nickname / title / address contain
// "Surfside" or "Boynton") speaks to guests as its owners, Vanessa & Taylor — never "Stay Hospitality",
// never the general manager's name. Every other property signs as it always has.
//
// DISPLAY ONLY. Nothing here writes: a Surfside book whose saved sign-off is empty or still the
// company default is SHOWN as "Vanessa & Taylor"; a sign-off a person typed that already names
// Vanessa or Taylor is kept exactly as typed. Pure — safe on the server and in the browser.

export const SURFSIDE_HOSTS = 'Vanessa & Taylor'
export const DEFAULT_SIGNOFF = 'Jon McGill, General Manager'
export const DEFAULT_GM_LABEL = 'GENERAL MANAGER'

/** The 1-pager's default welcome (the editor shows it as the placeholder). No brand name in it. */
export const FLYER_WELCOME_DEFAULT = "Thank you so much for choosing to stay with us. We hope this place feels like home from the moment you walk in, and that you make some wonderful memories here. We're a small, local team, so reviews mean the world to our business — if you love your stay, a few kind words in your booking app truly help us. Enjoy every minute."
/** The 1-pager is one page: a welcome longer than this starts to push the QR codes off it. */
export const FLYER_WELCOME_MAX = 420

const txt = (v: any): string => (typeof v === 'string' ? v.trim() : '')
const OWNERS = /vanessa|taylor/i
// The company, the title, or the GM by name — what a Surfside guest must never be signed off by.
const COMPANY = /stay[\s-]*hospitality|general\s+manager|\bG\.?M\.?\b|mc\s?gill|\bjon(athan)?\b/i

/** True for the Boynton Beach property ("Surfside"). Reads the book plus what /g/[id] adds from the listing. */
export function isSurfside(gb: any): boolean {
  if (!gb) return false
  const tag = [gb._unit, gb._unitName, gb._building, gb._nickname, gb.listing_name, gb.title, gb.sections?.guidelines?.address]
    .filter((x: any) => typeof x === 'string' && x).join(' ')
  return /surfside|boynton/i.test(tag)
}

/** Does this saved text name the company / the GM (so a Surfside book must not show it)? */
function namesCompany(v: string, gb: any): boolean {
  if (COMPANY.test(v)) return true
  const gm = txt(gb?.sections?.contact?.gmName)
  return !!gm && !OWNERS.test(gm) && v.toLowerCase().indexOf(gm.toLowerCase()) >= 0
}

/**
 * The sign-off a guest sees under the welcome / review note.
 * Surfside: "Vanessa & Taylor" when the saved one is empty or names Stay Hospitality / the general
 * manager; a saved one that says Vanessa or Taylor (or any other name a person typed) is kept.
 * Everyone else: the saved sign-off, else the house default.
 */
export function guideSignoff(gb: any): string {
  const saved = txt(gb?.sections?.contact?.signoff)
  if (!isSurfside(gb)) return saved || DEFAULT_SIGNOFF
  if (!saved) return SURFSIDE_HOSTS
  if (OWNERS.test(saved)) return saved
  return namesCompany(saved, gb) ? SURFSIDE_HOSTS : saved
}

/** The small caps label over the host's name on the magazine's contact strip ("GENERAL MANAGER"). */
export function guideHostLabel(gb: any): string {
  const saved = txt(gb?.sections?.contact?.gmLabel)
  if (!isSurfside(gb)) return saved || DEFAULT_GM_LABEL
  return !saved || COMPANY.test(saved) ? 'YOUR HOSTS' : saved
}

/** The host's name on the magazine's contact strip. */
export function guideHostName(gb: any): string {
  const saved = txt(gb?.sections?.contact?.gmName)
  if (!isSurfside(gb)) return saved
  if (!saved) return SURFSIDE_HOSTS
  if (OWNERS.test(saved)) return saved
  return COMPANY.test(saved) ? SURFSIDE_HOSTS : saved
}

/** The 1-pager's default signature (when the editor's "Signed" field is empty). */
export function flyerSignoffDefault(gb: any): string {
  return isSurfside(gb) ? SURFSIDE_HOSTS : 'Your hosts at Stay Hospitality'
}

/** Who answers the urgent line, in hard-coded default captions ("Stay Hospitality · 24/7"). */
export function guideBrand(gb: any): string {
  return isSurfside(gb) ? 'Your hosts' : 'Stay Hospitality'
}

/** A saved 1-pager label (sections._labels['flyer.welcome' | 'flyer.signoff']); '' when not set. */
export function flyerLabel(gb: any, key: 'flyer.welcome' | 'flyer.signoff'): string {
  const v = (gb?.sections?._labels || {})[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

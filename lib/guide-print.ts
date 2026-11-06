// PRINTED HOUSE MANUAL RULES + COMMON-SENSE HOW-TOS (Jon, 2026-11-06: "make sure the printable guidebook
// is optimized, formatted perfectly for printouts, make sure we have themes and editable option. Common
// sense issue — don't add it on how to ___").
//
// · COMMON SENSE. A how-to for a microwave, a kettle or a fridge wastes the guest's time and the paper.
//   isCommonSense() names them; they are left out of the phone guide and the print by default, and the
//   generator is told not to write them. Anyone can bring one back from the editor's Print options
//   (sections._print.show) — e.g. a microwave that really is unusual.
// · PRINT OPTIONS live on the book in sections._print, edited from the guidebook editor:
//     color   true (default) = the book's colour theme on headings, rules and boxes; false = black & white
//     hide    sections left off the printout: 'welcome' | 'rules' | 'faq' | 'howto' | 'checkout' | 'around' | 'help'
//     show    how-to titles to include even though they are common sense
//     drop    how-to titles to leave off the printout (and the phone guide)

export const COMMON_SENSE = /\b(microwave|kettle|toaster|refrigerator|fridge|freezer|mini[- ]?fridge|ice (tray|maker)|light(s|ing)?( switch(es)?)?|lamps?|toilet|faucet|sink|towels?|hair ?dryer|iron(ing board)?|hangers?|blinds|curtains|shades|dishes|dishware|cutlery|utensils|pots? (and|&) pans|cookware)\b/i
// A plain coffee maker is common sense; a Nespresso, Keurig or espresso machine is not.
const PLAIN_COFFEE = /^\s*(drip\s+)?coffee ?maker\s*$/i
const NOT_COMMON = /nespresso|keurig|espresso|induction|smart|thermostat|key ?fob|keypad|lock|code|safe|gate|elevator|garage|pool|grill|washer|(?<!hair\s?)dryer|dishwasher|beach|parking|wi-?fi|router|tv|television|stream/i

const norm = (t: any) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** True for how-tos nobody needs explained ("Microwave", "Electric kettle", "Mini fridge & freezer"). */
export function isCommonSense(title: any): boolean {
  const t = String(title || '')
  if (!t.trim()) return true
  if (PLAIN_COFFEE.test(t)) return true
  if (NOT_COMMON.test(t)) return false
  return COMMON_SENSE.test(t)
}

export type PrintPrefs = { color: boolean; hide: string[]; show: string[]; drop: string[] }
export const PRINT_SECTIONS: { key: string; label: string }[] = [
  { key: 'welcome', label: 'Welcome note' },
  { key: 'rules', label: 'House rules' },
  { key: 'checkout', label: 'Check-out list' },
  { key: 'faq', label: 'Parking, your unit & the beach (own page)' },
  { key: 'howto', label: 'House guide' },
  { key: 'around', label: 'Around you' },
  { key: 'help', label: 'Help & emergencies' },
]

export function printPrefs(sections: any): PrintPrefs {
  const p = (sections && sections._print) || {}
  const arr = (v: any) => (Array.isArray(v) ? v.map(norm).filter(Boolean) : [])
  return { color: p.color !== false, hide: Array.isArray(p.hide) ? p.hide.map(String) : [], show: arr(p.show), drop: arr(p.drop) }
}

/** Is this how-to shown? Dropped ones never; common-sense ones only when brought back. */
export function howtoShown(title: any, prefs: PrintPrefs): boolean {
  const k = norm(title)
  if (prefs.drop.indexOf(k) >= 0) return false
  if (isCommonSense(title)) return prefs.show.indexOf(k) >= 0
  return true
}

/** How-tos the FAQ page already answers — on paper they are not repeated in the house guide. */
export const FAQ_COVERED = /\b(park(ing)?|where to park|door|entry|keypad|check[- ]?in|wi-?fi|internet|beach)\b/i

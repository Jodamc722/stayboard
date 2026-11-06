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
//     hide    sections left off the printout: 'welcome' | 'rules' | 'faq' | 'maps' | 'howto' | 'checkout' | 'around' | 'help'
//     show    how-to titles to include even though they are common sense
//     drop    how-to titles to leave off the printout (and the phone guide)

// STANDARD vs SPECIAL (Jon, 2026-11-06: "if not induction stove don't put it on it; if espresso is standard
// don't put instructions on it. Only remote blinds, or new tech, smart homes etc. — standard items leave it
// be"). A how-to earns its place only when a guest could get it wrong:
//   SPECIAL  — induction cooktops, remote / motorised blinds, smart-home controls (hubs, smart locks, smart
//              thermostats, smart lights), anything about getting in or around (door, keypad, fob, gate,
//              elevator, garage, parking, the beach, maps), the pool / hot tub, the safe, alarm, shutters,
//              trash & recycling rules, EV charging.
//   STANDARD — every ordinary appliance: stove, oven, microwave, kettle, toaster, fridge, coffee maker,
//              espresso / Nespresso / Keurig, dishwasher, washer & dryer, TV / Smart TV / streaming, A/C and
//              a plain thermostat, lights, toilet, shower, blinds by hand, grill, iron, hair dryer…
// Standard ones are left out of every version (digital, magazine, 1-pager) and the generator is told not
// to write them. The editor's Print options can still bring one back for a unit where it really is odd.
const SPECIAL = /\b(induction|remote[- ]?(controlled\s+)?(blinds?|shades?|curtains?)|motori[sz]ed|automated|power(ed)? (blinds?|shades?)|smart[- ]?(home|hub|lock|blinds?|shades?|curtains?|thermostat|lights?|lighting|switch(es)?|panel|speaker)|alexa|google (home|nest)|nest|ecobee|lutron|control4|crestron|savant|sonos|home ?assistant|key ?fob|key ?card|keypad|door|entry|access|lock ?box|gate|elevator|lift|garage|park(ing)?|beach|walk|map|directions?|minutes? (away|walk|drive)|pool|hot ?tub|jacuzzi|spa|sauna|safe|alarm|security|shutters?|hurricane|generator|trash|recycl|garbage|ev charg|charger|tesla|solar)\b/i
const STANDARD = /\b(microwave|kettle|toaster|refrigerator|fridge|freezer|ice (tray|maker)|stove|stovetop|cook ?top|oven|range|coffee|espresso|nespresso|keurig|dishwasher|washer|dryer|washing machine|laundry|tv|television|streaming|roku|fire ?stick|cable|air ?condition(ing|er)?|a\/?c|ac unit|mini[- ]?split|thermostat|heater|ceiling fan|fan|lights?|lighting|lamps?|toilet|faucet|sink|shower|bath ?tub|towels?|linens?|hair ?dryer|iron(ing board)?|hangers?|blinds|curtains|shades|dishes|dishware|cutlery|utensils|pots?|pans|cookware|grill|bbq|barbecue|vacuum|blender|wi-?fi|internet|router)\b/i
export const COMMON_SENSE = STANDARD

const norm = (t: any) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** True for a how-to about a standard item nobody needs explained (a Smart TV, an espresso machine, the A/C). */
export function isCommonSense(title: any): boolean {
  const t = String(title || '')
  if (!t.trim()) return true
  if (SPECIAL.test(t)) return false
  return STANDARD.test(t)
}

/** A how-to to delete: a standard item, never one carrying a map (parking, the walk to the beach…). */
export function isStandardHowto(it: any): boolean {
  if (!it) return false
  if (it.photo && (it.photoFull === true || isMapItem(it))) return false
  return isCommonSense(it.title)
}

export type PrintPrefs = { color: boolean; hide: string[]; show: string[]; drop: string[] }
export const PRINT_SECTIONS: { key: string; label: string }[] = [
  { key: 'welcome', label: 'Welcome note' },
  { key: 'rules', label: 'House rules' },
  { key: 'checkout', label: 'Check-out list' },
  { key: 'faq', label: 'Parking, your unit & the beach (own page)' },
  { key: 'maps', label: 'Maps — full-size sheets' },
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

// ── MAPS AND DIAGRAMS (Jon, 2026-11-06, the Surfside parking map shrunk to a thumbnail: "when images
// attached like maps should not be like this format, can't read it, small … need to be a page") ──
// A how-to whose picture is a map — parking, the walk to the beach, the drive to Delray, a unit layout —
// gets the picture at full size: its own page in the magazine, full width (tap to open) on the phone,
// and a map sheet in the printed manual. Decided by the title; the editor can force it either way
// with the item's `photoFull` (true = always full size, false = keep the small photo).
const MAP_TITLE = /\b(map|park(ing)?|beach|walk(ing)?|direction|route|getting (there|to)|min(ute)?s? (away|walk|drive)|access|lot|layout|floor ?plan|find(ing)? (your|the)|where is)\b/i
export function isMapItem(it: any): boolean {
  if (!it || !it.photo) return false
  if (it.photoFull === true) return true
  if (it.photoFull === false) return false
  return MAP_TITLE.test(String(it.title || ''))
}

/** "About 3–5 minutes on foot. 1. From the lot… 2. Turn left…" → intro + one line per step. */
export function splitSteps(body: any): { intro: string; steps: string[] } {
  const t = String(body || '').replace(/\r/g, '').trim()
  if (!t) return { intro: '', steps: [] }
  const parts = t.split(/(?:^|\s|\n)(?=\d{1,2}[.)]\s+\S)/)
  if (parts.length < 3) return { intro: t, steps: [] }
  const first = /^\d{1,2}[.)]\s/.test(parts[0]) ? '' : parts.shift() || ''
  const steps = parts.map(p => p.replace(/^\d{1,2}[.)]\s+/, '').trim()).filter(Boolean)
  return steps.length >= 2 ? { intro: first.trim(), steps } : { intro: t, steps: [] }
}

// ── PRINT FORMAT (Jon, 2026-11-06: "3 versions: guest digital view, magazine and 1-pager") ──
// Each book (set per property from Admin › Guidebooks) prints as the full magazine or the 1-pager.
export type PrintFormat = 'magazine' | 'flyer'
export function printFormat(gb: any): PrintFormat {
  const f = gb?.sections?._print?.format
  return f === 'flyer' ? 'flyer' : 'magazine'
}

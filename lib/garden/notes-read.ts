// READING THE DESK'S NOTES (Jon, 2026-11-10: "reading notes … have Adam learn"). Cloudbeds reservation
// notes are the front desk's shorthand — "PP - (2 Vouchers)", "Premium VIP - $20.00 F&B Credit - Top
// Floor", "Pre Auth Done", a car and plate, "DO NOT MOVE", initials at the end. This turns a note into
// tags the desk can scan (Today, the guest profile) and that Adam reads. Pure: no I/O, so the page and
// the server share it. Nothing is guessed beyond the patterns below; the note itself is always shown.

export type NoteTag = { key: string; label: string; tone: 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' | 'brand' | 'slate'; detail?: string }

// The desk's abbreviations, as Adam is taught them (lib/garden/adam).
export const NOTE_GLOSSARY: Record<string, string> = {
  PP: 'Prepaid — the stay is paid',
  'Pre Auth': 'A pre-authorisation was taken on the card',
  Vouchers: 'Breakfast / F&B vouchers given for the stay (count in brackets)',
  VIP: 'VIP guest; Premium VIP usually carries a $20 F&B credit and a top-floor request',
  'F&B Credit': 'Food and beverage credit on the folio',
  UPG: 'Upgrade (pending or done); "UPG to DK" = upgraded to a Deluxe King',
  LCO: 'Late checkout',
  ECI: 'Early check-in',
  HKS: 'Housekeeping service; "NO HKS" = no housekeeping during the stay',
  CCD: 'Credit card declined — collect another card',
  'Hotel Collect': 'The OTA did not take payment; the guest pays the hotel (at check-in or checkout)',
  SD: 'Security deposit',
  'DO NOT MOVE': 'Room is locked to this guest — do not reassign',
  'KP / DK': 'Room type codes (e.g. King Premium / Deluxe King)',
}

const T = (key: string, label: string, tone: NoteTag['tone'], detail?: string): NoteTag => ({ key, label, tone, detail })

export function readNote(text: string): { tags: NoteTag[]; initials: string[]; vehicle: string | null } {
  const t = String(text || '')
  const tags: NoteTag[] = []
  const add = (x: NoteTag) => { if (!tags.some(y => y.key === x.key)) tags.push(x) }

  if (/\bPP\b/.test(t)) add(T('prepaid', 'Prepaid', 'emerald'))
  if (/pre[\s-]?auth(?:ori[sz]ation)?\s*(?:is\s*)?done/i.test(t)) add(T('preauth', 'Pre-auth done', 'emerald'))
  const v = t.match(/\((\d+)\s*vouchers?\)/i) || t.match(/(\d+)\s*vouchers?/i)
  if (v) add(T('vouchers', `${v[1]} voucher${v[1] === '1' ? '' : 's'}`, 'sky'))
  if (/premium\s+vip/i.test(t)) add(T('vip', 'Premium VIP', 'violet'))
  else if (/\bVIP\b/i.test(t)) add(T('vip', 'VIP', 'violet'))
  const fb = t.match(/\$\s?(\d+(?:\.\d\d)?)\s*F&B/i)
  if (fb) add(T('fb', `$${Number(fb[1])} F&B credit`, 'violet'))
  if (/top\s*floor/i.test(t)) add(T('topfloor', 'Top floor', 'sky'))
  if (/pool\s*view/i.test(t)) add(T('poolview', 'Pool view', 'sky'))
  if (/do\s*not\s*move/i.test(t)) add(T('nomove', 'Do not move', 'rose'))
  if (/pending\s*upg/i.test(t)) add(T('upg_pending', 'Upgrade pending', 'amber'))
  else if (/\bUPG\b|upgrade/i.test(t)) add(T('upg', 'Upgraded', 'brand'))
  if (/\bLCO\b|late\s*check[\s-]?out/i.test(t)) add(T('lco', 'Late checkout', 'amber'))
  if (/early\s*check[\s-]?in|\bECI\b/i.test(t)) add(T('eci', 'Early check-in', 'amber'))
  if (/accessib|wheelchair|elevator|first floor|ground floor|\bADA\b/i.test(t)) add(T('access', 'Accessibility', 'rose'))
  if (/connecting\s*rooms?/i.test(t)) add(T('connecting', 'Connecting rooms', 'sky'))
  if (/\b(cat|dog|pet)s?\b/i.test(t)) add(T('pet', 'Pet', 'amber'))
  if (/no\s*hks|no\s*housekeeping/i.test(t)) add(T('nohk', 'No housekeeping', 'amber'))
  if (/\bCCD\b|card\s*declined/i.test(t)) add(T('ccd', 'Card declined', 'rose'))
  if (/hotel\s*collect|guest\s*pay\s*hotel|pay(?:s)?\s*(?:the\s*)?(?:remaining\s*)?balance\s*upon\s*arrival/i.test(t)) add(T('hotelcollect', 'Pays the hotel', 'amber'))
  if (/package|luggage|belongings|delivered/i.test(t)) add(T('delivery', 'Delivery / luggage', 'sky'))
  if (/no[\s-]?show/i.test(t)) add(T('noshow', 'No-show?', 'rose'))
  if (/leak|broken|not working|a\/?c\b|air\s*condition|clog|repair/i.test(t)) add(T('issue', 'Room issue', 'rose'))
  if (/\bSD\b|security\s*deposit/i.test(t)) add(T('sd', 'Security deposit', 'slate'))

  // A car: make/model/colour words, or a "car pass" / VEHICLE: line.
  let vehicle: string | null = null
  const vm = t.match(/VEHICLE:\s*([^.,\n]{3,60})/i)
    || t.match(/\b((?:\d{2}\s+)?(?:black|white|grey|gray|silver|red|blue|green)?\s*(?:mercedes|nissan|honda|honday|hyundai|hiunday|toyota|subaru|chevrolet|chevy|ford|bmw|audi|tesla|jeep|kia|lexus|mazda|volkswagen|vw|dodge|gmc|ram)[^.,\n]{0,40})/i)
  if (vm) { vehicle = vm[1].replace(/\s+(?:car\s*pass|\d+\s*nights?|[A-Z]{2}(?:NO|\d)).*$/i, '').replace(/\s+/g, ' ').trim(); add(T('vehicle', 'Vehicle', 'slate', vehicle)) }

  // Staff initials at the end of a note ("… JL", "KH6309…" → KH).
  const initials = Array.from(new Set(Array.from(t.matchAll(/(?:^|[\s.])([A-Z]{2})(?=\s*$|\s*\d|\s*\.)/g)).map(m => m[1]).filter(x => !['PP', 'SD', 'HC', 'KP', 'DK', 'VIP', 'UPG', 'LCO'].includes(x))))
  return { tags, initials, vehicle }
}

/** Every note of a reservation read together, tags merged. */
export function readNotes(notes: string[]): { tags: NoteTag[]; initials: string[]; vehicle: string | null } {
  const tags: NoteTag[] = []; const initials = new Set<string>(); let vehicle: string | null = null
  for (const n of notes) {
    const r = readNote(n)
    for (const t of r.tags) if (!tags.some(x => x.key === t.key)) tags.push(t)
    r.initials.forEach(i => initials.add(i)); vehicle = vehicle || r.vehicle
  }
  return { tags, initials: Array.from(initials), vehicle }
}

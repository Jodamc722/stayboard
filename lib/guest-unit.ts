// GUEST-FACING unit name + number ("Surfside · Unit 4") for the guidebooks. Ops screens use lib/unit-label (nickname-first).

/**
 * "Unit 3" from the listing (Jon, 2026-11-06: "make sure the unit number is clear"). The guidebook's
 * own title is the marketing name, which rarely says which door is yours. Guesty's unit field wins;
 * otherwise the number at the end of the nickname ("Surfside - 3", "Salato 302"). Nothing when neither
 * has one — never a guess.
 */
export function guestUnitNo(l: any): string {
  const u = String(l?.unit || '').trim()
  if (u) return /^(unit|apt|suite|room|#)/i.test(u) ? u.replace(/^#\s*/, 'Unit ') : 'Unit ' + u
  const m = String(l?.nickname || '').match(/(?:^|[\s\-#])(\d{1,4}[A-Za-z]?)\s*$/)
  return m ? 'Unit ' + m[1] : ''
}

/**
 * The unit's NAME as the team and the signs use it (Jon, 2026-11-06: "we need the unit's name in the title
 * and the unit number, not just the unit number"): the nickname without its number — "Surfside - 4" →
 * "Surfside", "Salato 302" → "Salato" — else the building. Owner names in brackets are dropped.
 */
export function guestUnitName(l: any): string {
  const nick = String(l?.nickname || '').replace(/\([^)]*\)/g, ' ').replace(/(?:^|[\s\-#])(?:unit\s*)?\d{1,4}[A-Za-z]?\s*$/i, '').replace(/[\s\-–—·|#,]+$/, '').replace(/\s+/g, ' ').trim()
  if (nick && /[A-Za-z]{3,}/.test(nick) && nick.length <= 40) return nick
  return String(l?.building || '').trim()
}
/** "Surfside · Unit 4" — name and number together; either alone when that is all there is. */
export function guestUnitFull(l: any): string {
  const name = guestUnitName(l), num = guestUnitNo(l)
  return [name, num].filter(Boolean).join(' · ')
}


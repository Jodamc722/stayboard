// WHAT TO CALL A UNIT ON AN OPS SCREEN (Jon, 2026-09-08: "add the listing and unit number — like
// 17041, 17042 — that's not how it's showing, so it's impossible to know what unit it is without
// clicking into it").
//
// Every listing carries TWO names and they serve different readers:
//   nickname — what we call it: "Arya 1704/1", "17WEST - 402 - 2BR". Building + unit, always.
//   title    — the marketing headline the guest sees: "Bright Studio at The Arya Miami | City Views".
// Ops screens had been leading with `title`, which is the one name that never says which unit it is
// (23 Arya units, and their titles are near-identical). Guesty's own `unit` column is no help — it
// holds "1", "2", "1705" inconsistently.
//
// So: LEAD WITH THE NICKNAME, keep the title as the second line for anyone who needs it. Scoring
// still measures the marketing title (see `titleLen`) — this only changes what a human reads.

export type LabelledListing = { nickname?: any; title?: any; unit?: any; building?: any; id?: any }

const s = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()

/** The operational name: "Arya 1704/1". Falls back to the title, then the unit, then "Untitled unit". */
export function unitLabel(l: LabelledListing): string {
  return s(l?.nickname) || s(l?.title) || s(l?.unit) || 'Untitled unit'
}

/** The marketing headline, only when it adds something the label does not already say. */
export function unitSubLabel(l: LabelledListing): string | null {
  const t = s(l?.title)
  if (!t) return null
  const label = unitLabel(l)
  if (!t || t === label) return null
  return t
}

/**
 * The unit number pulled out of the nickname, for a compact chip: "Arya 1704/1" -> "1704/1",
 * "17WEST - 402 - 2BR" -> "402", "Salato 902" -> "902". Returns null when there is no number to
 * show (a house with a name, say) — never guess.
 */
export function unitNumber(l: LabelledListing): string | null {
  const nick = s(l?.nickname)
  if (nick) {
    // A unit token: digits, optionally /N or -N, e.g. 1704/1, 1002-2, 402, 6209.
    const m = nick.match(/\b(\d{2,4}(?:\s*[/-]\s*\d{1,2})?)\b/)
    if (m) return m[1].replace(/\s+/g, '')
  }
  const u = s(l?.unit)
  return u || null
}

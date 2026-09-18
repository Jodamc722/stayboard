// ── HOUSE COPY THAT HAS TO REACH DECKS ALREADY GENERATED ────────────────────
//
// Generating an onboarding copies the template into that report's own content JSON, which is
// right for the owner's facts and wrong for house lines: improve a sentence and every deck built
// before that day keeps the old one. The sample statement, the season curve and the channel
// reach already solve this with shape or date detection. These four are plain strings, so they
// get the plainest test there is: EXACT EQUALITY WITH THE RETIRED TEXT.
//
// That is deliberately conservative. A deck whose stored line still matches the retired default
// character for character was never touched here, so replacing it loses nothing. A deck whose
// line differs -- by an edit, by a later template, by a single typed comma -- is left exactly as
// it is. No heuristics, no date windows, nothing that can eat somebody's editing.
//
// Jon, 2026-09-18: "sometimes onboarding will be after the unit is live, so the line should not
// be 'before first guest' -- more this is an onboarding meeting." Every pair below is that same
// correction: the deck used to assume it was being read before the unit opened.
export type CopyPair = { retired: string[]; current: string }

export const HERO_HEADLINE: CopyPair = {
  retired: ['Everything we agree today, before your first guest.'],
  current: 'Everything we cover today, in one document you keep.',
}

export const CHECKLIST_HEADLINE: CopyPair = {
  retired: ['What is left before we can take a booking'],
  current: 'What is still open on your unit',
}

export const CHECKLIST_SUBTITLE: CopyPair = {
  retired: ['Neither of us can open this unit alone.'],
  current: 'Some of these only you can close.',
}

export const RAMP_HEADLINE: CopyPair = {
  retired: ['The first ninety days are bought, not earned'],
  current: 'A new listing’s first ninety days are bought, not earned',
}

export const RAMP_SUBTITLE: CopyPair = {
  retired: ['A new listing has no reviews and no standing in any channel’s ranking.'],
  current: 'It starts with no reviews and no standing in any channel’s ranking. If yours is already live, this is the curve you are on.',
}

/** The stored line, unless it is empty or is verbatim a retired default. */
export function houseLine(stored: unknown, pair: CopyPair): string {
  const s = String(stored == null ? '' : stored)
  if (!s.trim()) return pair.current
  return pair.retired.indexOf(s.trim()) >= 0 ? pair.current : s
}

// THE AGENDA IS MATCHED AS A WHOLE, NOT ROW BY ROW. Its retired version promised two things the
// deck does not do -- it offered to "score" the listing, which came off that slide months ago,
// and sold "direct numbers, not a shared inbox" three slides before a shared inbox appears under
// the team. Half-replacing a list that changed length would read worse than either version.
export const AGENDA_RETIRED_MARK = 'score it, and fix the weak parts'

/** True when a stored agenda is the retired one and should be replaced wholesale. */
export function agendaStale(rows: unknown): boolean {
  if (!Array.isArray(rows) || !rows.length) return true
  return rows.some(r => String((r && (r as { v?: string }).v) || '').includes(AGENDA_RETIRED_MARK))
}

/** The meeting, in order. Lives here so the staleness check and the default share one list. */
export const AGENDA_ROWS: { k: string; v: string }[] = [
    { k: 'Your team', v: 'The four people who run your unit, what each of them owns, and the direct lines.' },
    { k: 'Your listing', v: 'We open it live on every channel and go through it together — the photos, the words, the amenities.' },
    { k: 'Your owner portal', v: 'Your own Guesty login: the live calendar, your statements, and the spend you approve.' },
    { k: 'Revenue & strategy', v: 'Rate or occupancy, the season you are in, and what we are optimizing for month to month.' },
    { k: 'What to expect from us', v: 'What we handle without you, what reaches you, and how billables work.' },
    { k: 'What happens next', v: 'Anything still open on the unit, who owns it, and by when.' },
]

// ── THE HOUSE LISTS, AND THE PHRASE THAT DATES EACH ONE ─────────────────────
// Same contract as the lines above, one level up: a stored list containing a retired phrase is
// replaced whole, and any other list is left alone. Whole-list, not row-by-row, because all
// three have changed LENGTH -- the owner stay added a portal row, the W-9 split into W-9 plus
// ACH plus the portal login -- and a half-repaired list reads worse than either version.
//
// Jon, 2026-09-18: "mention ACH and W9 needs to be filled out, log in to Guesty owner portal,
// how to create an owner stay, owners will be charged a cleaning fee post stay."
//
// ONE KNOWN COST. A repaired money list carries the house $300 ceiling as literal text, so an
// owner who had been set to a different limit and whose deck predates this would read $300. No
// such owner exists today (no stored approval limits), and regenerating fixes it; the
// alternative -- leaving old decks promising that a departure clean is NEVER billed, three
// months before their first owner-stay statement says otherwise -- is the worse failure.
export const MONEY_RULES_RETIRED_MARK = 'Never billed to you. The guest'
// The mark must appear in the RETIRED list and NOT in the current one, or the repair fires
// forever and no edit on this slide ever survives. 'the blocks you asked us to hold' was the old
// calendar row and is gone from the new one; 'Every billed line traces to a job' -- my first
// choice -- appears in both, which would have made this permanent.
export const PORTAL_ITEMS_RETIRED_MARK = 'the blocks you asked us to hold'
export const CHECKLIST_RETIRED_MARK = 'W-9 and banking details for payouts'

/** The stored rows, unless they are empty or carry `mark` -- in which case the house list. */
export function houseRows<T>(stored: unknown, mark: string, current: T[]): T[] {
  if (!Array.isArray(stored) || !stored.length) return current
  const hit = stored.some(r => {
    const o = (r || {}) as Record<string, unknown>
    return [o.k, o.v, o.item].some(x => String(x || '').includes(mark))
  })
  return hit ? current : (stored as T[])
}

/** The departure-cleans headline on the statement slide, which stated the rule without its one
 *  exception. Repaired in place because the other two highlights are built from live numbers. */
export const CLEANS_HIGHLIGHT: CopyPair = {
  retired: ['Never billed to you, and never a line on your statement. The guest\u2019s cleaning fee pays for the turnover.'],
  current: 'Never billed to you after a guest stay \u2014 the guest\u2019s cleaning fee pays for the turnover. The clean after your own stay is the one exception, at cost.',
}

export const MONEY_RULES: { k: string; v: string }[] = [
    // THE OWNER STAY IS THE ONE EXCEPTION AND IT HAS TO BE STATED HERE (Jon, 2026-09-18:
    // "owners will be charged a cleaning fee post stay"). Said as a flat "never billed to you",
    // this rule is contradicted by the owner's own first statement after they use the unit --
    // which is the worst possible place to discover a carve-out we knew about all along.
    { k: 'Departure cleans', v: 'Never billed to you after a guest stay. The guest’s cleaning fee pays for the turnover, and if a clean costs us more than the fee collected that is our problem, not a line on your statement. The one exception is your own stay: there is no guest fee to cover it, so that clean is billed to you at cost.' },
    { k: 'Labor', v: '$40 an hour, or a flat price agreed for a defined job. Time is the technician’s actual clock in and out on the task, not an estimate.' },
    { k: 'Parts and supplies', v: 'At cost. No markup. A $19 faucet cartridge is $19 on your statement.' },
    { k: 'Guest-caused damage', v: 'Billed to the guest or their channel, not to you. You only see it if we fail to recover it, and then you see why.' },
    { k: 'Under $300', v: 'We handle it and it appears on your next statement. This threshold is yours to set — raise it, lower it, or set it to zero and see every item first.' },
    { k: 'Over $300', v: 'It goes to your order sheet before anyone spends anything, with photos, the reason, and usually three options. Nothing over your limit gets bought without your yes.' },
    { k: 'Emergencies', v: 'Active leak, no A/C, lockout, anything unsafe with a guest in house — we act first and tell you immediately. This is the one exception to the rule above, and we would rather explain a $600 invoice than a flooded unit.' },
]

export const PORTAL_ITEMS: { k: string; v: string }[] = [
    { k: 'Your calendar, and your own stays', v: 'Every reservation as it lands and the nights already sold — the same calendar we work from, not a copy of it. Block your own dates here and they become an owner stay that nothing can book over. Tell us early; the clean after an owner stay is billed to you at cost, since no guest fee covers it.' },
    { k: 'Your monthly report', v: 'Occupancy, rate, revenue, what we did, what guests said, what is booked ahead. One link, always the same link.' },
    { k: 'Your order sheet', v: 'Anything we want to buy for the unit, with photos, the reason, price options, and four buttons: approve, I will supply it, not now, no.' },
    { k: 'Your statement', v: 'Rental, less commission, less anything billed that month, equals what hits your account. Every billed line traces to a job with a date and a photo.' },
]

export const CHECKLIST_ROWS: { item: string; who: string; by: string }[] = [
    // Named exactly (Jon, 2026-09-18: "mention ACH and W9 needs to filled out, log in to Guesty
    // owner portal"). "Banking details" is not a task anyone can tick off; a signed W-9 and a
    // completed ACH authorization are.
    { item: 'W-9 signed', who: 'Owner', by: '' },
    { item: 'ACH authorization completed — this is how you get paid', who: 'Owner', by: '' },
    { item: 'Owner portal invite sent, and you have logged in once', who: 'Both', by: '' },
    { item: 'Short-term rental rider on your insurance', who: 'Owner', by: '' },
    { item: 'HOA registration and any rental approval', who: 'Owner', by: '' },
    { item: 'County tourist tax registration', who: 'Stay', by: '' },
    { item: 'Smart lock installed, codes into Guesty', who: 'Stay', by: '' },
    { item: 'Opening buy list approved and delivered', who: 'Owner', by: '' },
    { item: 'Linens stocked — three full sets per bed', who: 'Stay', by: '' },
    { item: 'Professional photos', who: 'Stay', by: '' },
    { item: 'Listing written and live on every channel', who: 'Stay', by: '' },
    { item: 'Calendar sync verified across all channels', who: 'Stay', by: '' },
    { item: 'Wi-Fi in the unit’s name, password into the guidebook', who: 'Owner', by: '' },
    { item: 'Parking spot or guest parking rules confirmed', who: 'Owner', by: '' },
]

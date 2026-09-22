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
  retired: ['Everything we agree today, before your first guest.', 'Everything we cover today, in one document you keep.'],
  current: 'Your onboarding, in one document.',
}

export const CHECKLIST_HEADLINE: CopyPair = {
  retired: ['What is left before we can take a booking'],
  current: 'What is still open on your unit',
}

export const CHECKLIST_SUBTITLE: CopyPair = {
  retired: ['Neither of us can open this unit alone.', 'Some of these only you can close.'],
  current: 'Items marked Owner need your action.',
}

export const RAMP_HEADLINE: CopyPair = {
  retired: ['The first ninety days are bought, not earned', 'A new listing’s first ninety days are bought, not earned'],
  current: 'A new listing’s first 90 days',
}

export const RAMP_SUBTITLE: CopyPair = {
  retired: [
    'A new listing has no reviews and no standing in any channel’s ranking.',
    'It starts with no reviews and no standing in any channel’s ranking. If yours is already live, this is the curve you are on.',
    'No reviews yet, no ranking yet. If yours is already live, this is the curve you are on.',
    'New listings start with no reviews and no search ranking. Here is what to expect.',
  ],
  current: 'New listings start with no reviews and no search ranking. Here is the curve, and how we shorten it.',
}

// Jon, 2026-09-18: "less wordy if possible, I can share more details on the call." The lines
// below are the trimmed versions; each older one is retired by exact text or by a phrase it
// alone contained, so decks already generated pick the short line up and edited ones are left.
export const WELCOME_BODY: CopyPair = {
  retired: [
    'This document is the call itself. We fill it in together as we talk, and it stays yours afterwards as the record of what we agreed.',
    'We fill this in together on the call, and it stays yours afterwards.',
  ],
  current: 'Completed together on this call. Yours to keep.',
}

export const SUPPORT_NOTE: CopyPair = {
  retired: [
    'Anything that is not urgent, anything you would rather put in writing, and anything you want a record of. Watched every business day.',
    'Anything not urgent, or that you want in writing. Watched every business day.',
  ],
  current: 'For non-urgent requests and anything in writing. Monitored every business day.',
}

// Jon, 2026-09-22: "we would never give up rev for reviews." The old ramp said the opening rate
// was "set below target to win the first bookings" and that a normal-looking month one meant we
// had "priced too high and gave up reviews" — which reads as a manager who discounts an owner's
// asset to buy itself social proof. That is not what happens and it is not what we would sell.
//
// What actually happens: a listing with no reviews and no ranking CONVERTS worse at the same
// price, so the rate the market will pay for it in week one is genuinely lower than the rate it
// will pay in week twelve. We price to that demand and take every night that clears it. Reviews
// are what we earn from nights we would otherwise have left empty — not a trade, a by-product.
// The retired marks below carry the old wording out of decks already generated.
export const RAMP_BANDS_RETIRED_MARKS = ['Expect low occupancy and a rate you will not love', 'first owner report worth judging us on', 'a rate you will not love', 'whose numbers mean anything', 'Opening rate set below target', 'Goal: five completed stays and five reviews', 'Rates move toward market']
export const RAMP_BANDS: { k: string; v: string }[] = [
  { k: 'Days 1–30', v: 'With no reviews and no ranking, the listing converts at a lower rate than it will later. We price to what the market will actually pay each night and take every booking that clears it.' },
  { k: 'Days 31–60', v: 'Early reviews lift placement in search. Occupancy climbs first, and rate follows it up as the listing earns its position.' },
  { k: 'Days 61–90', v: 'Enough history to hold market rate. The first month whose numbers reflect the asset rather than its age.' },
]
export const RAMP_NOTE: CopyPair = {
  retired: [
    'We would rather tell you this now than have you read month one as a failure. If month one looks like a normal month, we priced too high and left reviews on the table.',
    'If month one looks like a normal month, we priced too high and left reviews on the table.',
    'If month one looks normal, we priced too high and gave up reviews.',
  ],
  current: 'We do not trade revenue for reviews. Every night is priced to the best rate the market will pay that day — the reviews come from filling nights that would otherwise have gone empty.',
}

// Jon, 2026-09-18: "keep it professional, short and clear. We don't need fluff." Section titles
// and subtitles that decks already carry, each retired by exact text.
export const STATEMENT_HEADLINE: CopyPair = {
  retired: ['Your Guesty owner statements'],
  current: 'Your monthly owner statement',
}
export const STATEMENT_SUBTITLE: CopyPair = {
  retired: [
    'A worked month, line by line, and the rules behind every line.',
    'A worked sample, not your numbers \u2014 so you know how to read the real one.',
  ],
  current: 'A sample month, so you can read the real one.',
}
export const NOTES_SUBTITLE: CopyPair = {
  retired: ['Anything else that came up, and anything still open.'],
  current: 'Open items and notes.',
}
export const SEASON_SUBTITLE: CopyPair = {
  retired: ['December through April is the window everything else in the year prepares for.'],
  current: 'December through April carries the year.',
}
export const SEASON_LABEL: CopyPair = {
  retired: ['of the year\u2019s revenue lands December through April'],
  current: 'of annual revenue, December through April',
}
export const GUESTY_SUBTITLE: CopyPair = {
  retired: ['Your own login to the system we actually run on.'],
  current: 'Your login to the system we run on.',
}
export const CHANNELS_HEADLINE: CopyPair = {
  retired: ['Your calendar, on every channel that matters'],
  current: 'One calendar, 40+ channels',
}
export const SECTION_HEAD: Record<string, CopyPair> = {
  checklist: CHECKLIST_HEADLINE, ramp: RAMP_HEADLINE, statement: STATEMENT_HEADLINE, channels: CHANNELS_HEADLINE,
}
export const SECTION_SUB: Record<string, CopyPair> = {
  checklist: CHECKLIST_SUBTITLE, ramp: RAMP_SUBTITLE, statement: STATEMENT_SUBTITLE, notes: NOTES_SUBTITLE,
  season: SEASON_SUBTITLE, guesty: GUESTY_SUBTITLE,
}

// Discussion questions, by exact retired text. Decks store them per section; a stored question
// matching a retired one is shown in its shorter form.
export const ASK_REWRITES: Record<string, string> = {
  'Anything we got wrong, or that you are taking out?': 'Anything incorrect, or being removed?',
  'Anything here you would be upset to see damaged?': 'Anything you would not want damaged?',
  'Anything in the description that is not true, or that you would never say?': 'Anything in the description that is inaccurate?',
  'What does this unit have that the building’s other listings do not?': 'What sets this unit apart from others in the building?',
  'What does a good first year look like to you?': 'What does a good first year look like?',
  'If we can only have one — higher rate, or higher occupancy?': 'Priority: higher rate, or higher occupancy?',
  'Owner blocks — how often, and how much notice can you give us?': 'Owner stays: how often, and with how much notice?',
  'Are you comfortable opening under target rate for the first 30–45 nights?': 'Comfortable opening below target rate for the first 30–45 nights?',
  'Is there a date this has to be earning by?': 'Any date this unit needs to be earning by?',
  'Any dates you already know you are blocking this season?': 'Any owner dates to block this season?',
  'Is there anything already installed we should keep or work around?': 'Anything already installed we should keep?',
  'Anything you would rather we did not put in?': 'Anything you do not want installed?',
}
export function houseAsk(q: unknown): string {
  const s = String(q || '')
  return ASK_REWRITES[s.trim()] || s
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
// Two marks: the original agenda promised to "score" the listing; the next one counted the team
// as four, which stopped being true the day the editor grew an "Add someone" button.
export const AGENDA_RETIRED_MARKS = ['score it, and fix the weak parts', 'The four people who run your unit, what each', 'what each of them owns, and the direct lines', 'Who runs your unit, and their direct lines']

/** True when a stored agenda is the retired one and should be replaced wholesale. */
export function agendaStale(rows: unknown): boolean {
  if (!Array.isArray(rows) || !rows.length) return true
  return rows.some(r => AGENDA_RETIRED_MARKS.some(m => String((r && (r as { v?: string }).v) || '').includes(m)))
}

/** The meeting, in order. Lives here so the staleness check and the default share one list. */
export const AGENDA_ROWS: { k: string; v: string }[] = [
    { k: 'Your team', v: 'Who runs your unit and how to reach them.' },
    { k: 'Your listing', v: 'Photos, description and amenities, reviewed together.' },
    { k: 'Your owner portal', v: 'Your Guesty login: calendar, statements and approvals.' },
    { k: 'Revenue & strategy', v: 'Pricing approach and your season.' },
    { k: 'What to expect from us', v: 'What we handle, what we send you, how billing works.' },
    { k: 'What happens next', v: 'Open items, owners and dates.' },
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
export const MONEY_RULES_RETIRED_MARK = ['Never billed to you. The guest', 'that is our problem, not a line on your statement', 'The one exception is your own stay: no guest fee covers it']
// The mark must appear in the RETIRED list and NOT in the current one, or the repair fires
// forever and no edit on this slide ever survives. 'the blocks you asked us to hold' was the old
// calendar row and is gone from the new one; 'Every billed line traces to a job' -- my first
// choice -- appears in both, which would have made this permanent.
export const PORTAL_ITEMS_RETIRED_MARK = ['the blocks you asked us to hold', 'not a copy of it', 'the same calendar we work from']
export const CHECKLIST_RETIRED_MARK = ['W-9 and banking details for payouts', 'this is how you get paid']

/** The stored rows, unless they are empty or carry `mark` -- in which case the house list. */
export function houseRows<T>(stored: unknown, mark: string | string[], current: T[]): T[] {
  if (!Array.isArray(stored) || !stored.length) return current
  const marks = Array.isArray(mark) ? mark : [mark]
  const hit = stored.some(r => {
    const o = (r || {}) as Record<string, unknown>
    return [o.k, o.v, o.item].some(x => marks.some(m => String(x || '').includes(m)))
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
    // "owners will be charged a cleaning fee post stay").
    { k: 'Departure cleans', v: 'Not billed after guest stays; the guest’s cleaning fee covers the turnover. Cleaning after an owner stay is billed at cost.' },
    { k: 'Labor', v: '$40 per hour, or a flat price agreed in advance. Actual time on the task.' },
    { k: 'Parts and supplies', v: 'At cost. No markup.' },
    { k: 'Guest-caused damage', v: 'Billed to the guest or channel. You see it only if we cannot recover it.' },
    { k: 'Spending under $300', v: 'Handled by us and shown on your next statement. You set the threshold.' },
    { k: 'Spending over $300', v: 'Sent for your approval first, with photos, reason and options.' },
    { k: 'Emergencies', v: 'Active leak, no A/C, lockout or a safety issue with a guest in house: we act first and notify you immediately.' },
]

export const PORTAL_ITEMS: { k: string; v: string }[] = [
    { k: 'Your calendar, and your own stays', v: 'Every reservation as it lands. Block your own dates to create an owner stay; cleaning after it is billed at cost.' },
    { k: 'Your monthly report', v: 'Occupancy, rate, revenue, work completed and bookings ahead. One link, sent by us.' },
    { k: 'Your order sheet', v: 'Purchase requests with photos, reason and price options. Approve, supply it yourself, defer or decline.' },
    { k: 'Your statement', v: 'Rental income, less commission and monthly charges. Every charge traces to a job.' },
]

export const CHECKLIST_ROWS: { item: string; who: string; by: string }[] = [
    // Named exactly (Jon, 2026-09-18: "mention ACH and W9 needs to filled out, log in to Guesty
    // owner portal"). "Banking details" is not a task anyone can tick off; a signed W-9 and a
    // completed ACH authorization are.
    { item: 'W-9 signed', who: 'Owner', by: '' },
    { item: 'ACH authorization completed', who: 'Owner', by: '' },
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

// ── ADOPTING THE HOUSE COPY INTO A DECK ─────────────────────────────────────
//
// THE BUG THIS EXISTS TO FIX (Jon, 2026-09-18: "it's also not letting me edit the text").
// The repairs above began life as render-time substitutions: if the stored line is the retired
// one, draw the house one instead. That is correct for a reader and quietly broken for an
// editor. Typing into a substituted field writes the new text to the deck's content, but the
// staleness test still looks at the OLD stored value -- or, worse, at a sibling field or the
// deck's generation date, neither of which the edit changes -- so the very next render throws
// the edit away and paints the house copy back. From the outside the field simply refuses to
// take input.
//
// A substitution that outlives the edit is not a repair, it is a lock. So the substitution is
// now write-once: the moment a deck is opened for editing, anything still carrying retired copy
// is ADOPTED into the deck's own content, and from then on there is nothing to substitute --
// every field reads from storage and every edit sticks. Readers still get the render-time
// fallback, because a reader never edits and their deck is never written to.
//
// Each test below looks at the field it repairs, never at a neighbour, so that adopting one
// thing cannot mask another.
export const CHANNEL_BODY_RETIRED_MARKS = [
  'published everywhere, reconciled back to one place',  // the original one-liner
  'nine channel connections',                            // the 200+ version, retired same day
  'Being on thirty is what turns a slow Tuesday',        // the long template body
  'Your calendar is one calendar',                       // the 2026-09-18 body, trimmed same day
  'which is why a unit can be priced for occupancy',     // trimmed again, same day
]

export const STATEMENT_ALSO_RETIRED_MARKS = [
  'as well as on the rent',                              // circular reimbursement wording
  'passing through to us',                               // the "Cleaning fee" row owners never see
  'shown so the rental line reads as a real number',     // reimbursement described as the OTA cut
  'Always labelled with the month',                      // British spelling, 2026-09-18
  'You will not see either after a guest stay',          // long version, trimmed 2026-09-18
  'Always labeled with the month',
  'We keep the cleaning fee and it pays for the turnover',
  'No guest fee covers that turnover',
]

const hasMark = (text: unknown, marks: string[]): boolean => {
  const s = String(text || '')
  return marks.some(m => s.includes(m))
}

/** True when a stored channels paragraph is one of ours from before today. */
export function channelBodyStale(subtitle: unknown): boolean {
  return !String(subtitle || '').trim() || hasMark(subtitle, CHANNEL_BODY_RETIRED_MARKS)
}

/** True when stored reading-guide rows are one of the retired sets. */
export function statementAlsoRowsStale(rows: unknown): boolean {
  if (!Array.isArray(rows) || !rows.length) return true
  return rows.some(r => hasMark((r as { v?: string } | null)?.v, STATEMENT_ALSO_RETIRED_MARKS))
}

// ── THE MARKETS WE SAY WE ARE IN ────────────────────────────────────────────
// Jon, 2026-09-18: "can we add West Palm Beach to our markets".
//
// It was already a market. Palm Beach County has had its own segment, its own ADR and occupancy
// defaults and 20 listings (Lake Worth Beach and Riviera Beach — Capri, Lucerne, Amrit) for a
// while. These two lines were the last place the company still introduced itself as Miami and
// Broward only, which is the version every owner has read.
//
// Matched on a phrase rather than the whole paragraph: the stored text is the evaluated string,
// newlines and all, and pinning a repair to 300 characters of prose means it stops working the
// first time someone fixes a comma.
export const OVERVIEW_BODY_RETIRED_MARK = ['in Miami and Broward end to end', 'not a marketplace of contractors we hope shows up', 'our own people, on our own payroll', 'guest care are in-house']
export const OVERVIEW_BODY =
  'Stay Hospitality manages short-term rentals in Miami, Broward and West Palm Beach: listing, pricing, guest communication, turnovers and maintenance.\n\n' +
  'One team, one system, one monthly statement.'

export const COMPANY_STATS_RETIRED_MARK = 'Miami & Broward'
export const COMPANY_STATS: { k: string; v: string }[] = [
  { k: 'Markets', v: 'Miami, Broward & West Palm Beach' },
  { k: 'Units managed', v: '400+' },
  { k: 'Channels', v: 'Airbnb \u00b7 Vrbo \u00b7 Booking.com' },
  { k: 'In-house', v: 'Housekeeping, maintenance & guest care' },
]

/** The stored paragraph, unless it is empty or still carries `mark`. */
export function houseBody(stored: unknown, mark: string | string[], current: string): string {
  const s = String(stored || '')
  if (!s.trim()) return current
  return (Array.isArray(mark) ? mark : [mark]).some(m => s.includes(m)) ? current : s
}

// ── THE PORTAL, AS OUR ACCOUNT ACTUALLY HAS IT ──────────────────────────────
// Read from Guesty's own Owners Portal settings on 2026-09-18 (Operations > Owners > Portal
// settings), not from memory. Two things were wrong in the deck.
//
// 1. THE ADDRESS. The deck sent owners to stay.guestyowners.com. The account's portal is
//    stayhospitality.guestyowners.com. An owner following the deck could not sign in at all,
//    which is the single worst sentence to get wrong in an onboarding document.
//
// 2. WHAT IS ACTUALLY SWITCHED ON. The portal item list promised "what guests said", and guest
//    reviews are turned OFF for our owners (Jon, 2026-09-18: "we won't let them see reviews on
//    owner portal"). Both "Display guest reviews" and "Display overall guest rating" are off, as
//    are the owner inbox, cleaning photos and inspection photos.
//
// What IS on, and therefore what the deck may promise:
//   Performance  : booked nights · owner revenue · revenue per listing · occupancy ·
//                  net rental income
//   Calendar     : nightly rate · reserved guest reservations · reservation tooltip ·
//                  guest name (full name)
//   Owner stays  : owner booked nights · upcoming owner reservations ·
//                  ALLOW THE OWNER TO MAKE RESERVATIONS  (check-in/out time editing is off)
//   Reports      : reservations report
//   Extras       : help center only
export const PORTAL_URL = 'https://stayhospitality.guestyowners.com'
export const PORTAL_URL_RETIRED_MARK = 'stay.guestyowners.com'

/** The stored portal address, unless it is empty or the retired (wrong) one. */
export function housePortalUrl(stored: unknown): string {
  const s = String(stored || '').trim()
  if (!s) return PORTAL_URL
  // The retired value is a strict prefix of the correct one, so match on the host, not a substring.
  const host = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return host === PORTAL_URL_RETIRED_MARK ? PORTAL_URL : s
}


// ── THE TEAM SUBTITLE COUNTS THE CARDS ──────────────────────────────────────
// "The four people who run your unit" was typed as a constant the day the team was four. The
// editor has had "Add someone" since 2026-09-17, so a fifth card made the line wrong on the
// slide it sits above. The number is now read from the cards at render time.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
export const TEAM_SUBTITLE_RETIRED = 'The four people who run your unit, and the inbox behind them.'
export const TEAM_SUBTITLE = 'Your points of contact, and the support inbox.'
export function teamSubtitle(_count: number): string { return TEAM_SUBTITLE }
/** The stored subtitle unless it is blank or one of the counted "N people who run your unit" lines. */
export function houseTeamSubtitle(stored: unknown, _count: number): string {
  const v = String(stored || '').trim()
  if (!v || v === TEAM_SUBTITLE_RETIRED) return TEAM_SUBTITLE
  const counted = /^The (person|\w+ people) who runs? your unit, and the inbox behind them\.$/.test(v)
  return counted ? TEAM_SUBTITLE : v
}

// ── THE THREE STATEMENT RULES, REPAIRED BY MARK ──────────────────────────────
// Slide 14 on a deck generated before today still read "Anything over $250" and a departure-
// cleans rule with no owner-stay exception. The exact-match repair missed it because that deck
// carried an even older wording than the one I had recorded as retired. Marks instead: a stale
// dollar figure, or a cleans rule that never mentions the guest stay it applies to.
export const STATEMENT_HIGHLIGHTS: { k: string; v: string }[] = [
  { k: 'Departure cleans', v: 'Not billed after guest stays; the guest\u2019s cleaning fee covers the turnover. Cleaning after an owner stay is billed at cost.' },
  { k: 'Labor $40/hr, parts at cost', v: 'Actual technician time. No markup, no trip charge.' },
  { k: 'Anything over $300', v: 'Sent to you first with photos and options. No purchase without your approval.' },
]
export function statementHighlightsStale(rows: unknown): boolean {
  if (!Array.isArray(rows) || !rows.length) return true
  return rows.some(r => {
    const o = (r || {}) as { k?: string; v?: string }
    const k = String(o.k || ''), v = String(o.v || '')
    if (/\$250\b/.test(k) || /\$250\b/.test(v)) return true
    // Every earlier cleans rule opened "Never billed to you"; the current one does not.
    if (/^Departure cleans/i.test(k) && /Never billed to you/.test(v)) return true
    if (/^Anything over/i.test(k) && /Nothing is bought without your yes/.test(v)) return true
    return false
  })
}

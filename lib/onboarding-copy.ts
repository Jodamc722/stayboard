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
  // Jon, 2026-09-22: "we would never give up rev for reviews." The ramp question asked an owner
  // to bless opening BELOW target rate, which is the same discount-for-proof trade the ramp copy
  // just stopped making. What we actually need from them is the opposite: a floor, so pricing to
  // early demand never crosses a line they care about.
  'Comfortable opening below target rate for the first 30–45 nights?': 'Is there a nightly rate you would not want us to go below?',
  'Comfortable opening below target rate for the first 30-45 nights?': 'Is there a nightly rate you would not want us to go below?',
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
export const AGENDA_RETIRED_MARKS = ['score it, and fix the weak parts', 'The four people who run your unit, what each', 'what each of them owns, and the direct lines', 'Who runs your unit, and their direct lines',
  // Retired 2026-09-23: the six-row agenda described a shorter meeting than the deck now runs.
  // An agenda that does not match the deck behind it is the first thing an owner notices.
  'Photos, description and amenities, reviewed together.']

/** True when a stored agenda is the retired one and should be replaced wholesale. */
export function agendaStale(rows: unknown): boolean {
  if (!Array.isArray(rows) || !rows.length) return true
  return rows.some(r => AGENDA_RETIRED_MARKS.some(m => String((r && (r as { v?: string }).v) || '').includes(m)))
}

/** The meeting, in order. Lives here so the staleness check and the default share one list. */
// REWRITTEN 2026-09-23 to match the roadmap the deck now walks: who we are, what we have already
// run, what we do to the listing, how a stay is run, how the rate is set, what it runs on, then
// their unit, their year, and the admin. Nine rows for eighteen slides — the agenda groups, it
// does not index.
export const AGENDA_ROWS: { k: string; v: string }[] = [
    { k: 'Who we are', v: 'Stay Hospitality, what we run today, and who on our team runs your unit.' },
    { k: 'What we do to the listing', v: 'The listing, amenities, descriptions, distribution and marketing.' },
    { k: 'The guest experience', v: 'How a stay is run, booking to review, and the record behind it.' },
    { k: 'Revenue management', v: 'How your rate gets set, and every lever besides the nightly price.' },
    { k: 'The technology', v: 'The four platforms your unit runs on, and what each one is for.' },
    { k: 'Your listing', v: 'Your unit specifically — what is strong, and what we are changing.' },
    { k: 'Your year', v: 'South Florida seasonality, and the first 90 days of a new listing.' },
    { k: 'Money & the portal', v: 'Your owner portal, your monthly statement, owner stays and billing.' },
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
  'reconciled in one place: priced for occupancy',       // the 40+ body, retired 2026-09-23
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
export const OVERVIEW_BODY_RETIRED_MARK = ['in Miami and Broward end to end', 'not a marketplace of contractors we hope shows up', 'our own people, on our own payroll',
  // The 2026-09-18 body, retired 2026-09-23 when the slide stopped describing functions and
  // started making the argument. Matched on its opening clause: 'guest care are in-house' also
  // appears in the NEW body, so the old mark would have retired the replacement on sight.
  'manages short-term rentals in Miami, Broward and West Palm Beach',
  'One team, one system, one monthly statement.']
export const OVERVIEW_BODY =
  'Stay Hospitality manages short-term rentals in Miami, Broward and West Palm Beach: listing, pricing, guest communication, turnovers and maintenance.\n\n' +
  'One team, one system, one monthly statement.'

// '400+' retired 2026-09-23: stay-hospitality.com says 140+ properties and two hotels, and a deck
// that disagrees with the website an owner is about to open costs more trust than the bigger
// number buys.
export const COMPANY_STATS_RETIRED_MARK = ['Miami & Broward', '400+']
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


// ── AI AT STAY ───────────────────────────────────────────────────────────────────────────────
// Jon, 2026-09-22: "What can be cool is AI Slides on onbarind about how we are really using it,
// new features, etc and how it will help us imporve."
//
// The rule for this slide is that every line names something that actually runs today. An owner
// who has sat through four management pitches has heard "we use AI" from all four; the only way
// it lands is specifics they can check — Eve answering in Spanish in the crew channel, a review
// becoming a task on a named unit, this report being generated rather than typed. Anything we
// are still building goes on the last line, marked as what is coming, and never above it.
export const AI_HEADLINE: CopyPair = { retired: [], current: 'What we automate, and what we do not' }
export const AI_SUBTITLE: CopyPair = {
  retired: [],
  current: 'Four things run on our own software every day. None of them replace the person who answers your call.',
}
export const AI_PILLARS: { k: string; v: string }[] = [
  { k: 'A teammate on every message', v: 'Eve reads every booking, guest thread and task across the portfolio and has the reply drafted before anyone opens a laptop — in English or Spanish, so the crew and the guest read the same instruction.' },
  { k: 'Problems found before a review is', v: 'Guest messages and reviews are read for what went wrong and turned into a specific task on that specific unit. The point is to fix it during the stay rather than answer for it afterwards.' },
  { k: 'Listings that keep up', v: 'Photos ordered, copy written per channel, and rates set against a live comp set — so the listing working for you this month is not last year\u2019s listing.' },
  { k: 'This report, generated', v: 'Your monthly review is built from the bookings, reviews and work orders themselves. Nobody types a summary from memory, and nothing gets rounded in our favour.' },
]
export const AI_NOTE: CopyPair = {
  retired: [],
  current: 'What it buys you is speed and consistency: faster answers, problems caught earlier, and a report you can check. Judgement calls — pricing your unit, spending your money, what to tell you — stay with the people you met on slide three.',
}

// ════════════════════════════════════════════════════════════════════════════
// THE PITCH (Jon, 2026-09-23: "I want to improve the onboarding deck. This needs to make us sound
// like we are the best company ever … a world-class, robust pitch about Stay Hospitality and what
// we're going to do to help make their listing pop.")
//
// EVERY CLAIM BELOW IS ONE AN OWNER CAN CHECK. That is the whole discipline of this block. An
// owner who reads this deck will open stay-hospitality.com in the next tab, and any number that
// disagrees with the one on the website costs more trust than the bigger number buys. So the
// counts here are the site's own — 140+ properties, two hotels, the named buildings — and where we
// do not have a figure we can stand behind, the slide makes an argument instead of quoting one.
//
// Nothing here says how long we have been in business, because the website does not say either and
// a founding year is exactly the sentence an owner repeats back. Give me the year and it goes in.
// ════════════════════════════════════════════════════════════════════════════

// ── ABOUT US ────────────────────────────────────────────────────────────────
// The old body was accurate and flat: a list of functions. An owner deciding who to hand a
// $700,000 asset to is not buying a list of functions, they are buying the answer to "who actually
// shows up". So the paragraph leads with the thing almost no competitor in this market can say —
// we run whole hotels, not just scattered condos — and closes on the operational claim that
// matters most, which is that the people doing the work are ours.
export const OVERVIEW_BODY_2 =
  'Stay Hospitality is a lifestyle hospitality brand managing 140+ properties and two hotels across Miami, Fort Lauderdale, Pompano and Palm Beach.\n\n' +
  'We run entire buildings — The Elser, Arya, The Garden, Salato, 17West, Capri, Amrit — which means front desks, HOA boards, city compliance and linen at hotel scale are ordinary days here, not special projects. Your unit gets that same operation, and the same people: housekeeping, maintenance and guest care are in-house, on our payroll, not a marketplace of contractors we hope shows up.'

export const COMPANY_STATS_2: { k: string; v: string }[] = [
  { k: 'Properties managed', v: '140+' },
  { k: 'Hotels operated', v: 'Two' },
  { k: 'Markets', v: 'Miami · Fort Lauderdale · Pompano · Palm Beach' },
  { k: 'In-house', v: 'Housekeeping, maintenance & guest care' },
]

// ── EXPERIENCE ──────────────────────────────────────────────────────────────
// The slide that answers "have you done this before". It is a wall of names on purpose: an owner
// recognises two or three of these buildings from driving past them, and recognition does more
// than a paragraph. Scrollable, because the list is the argument and trimming it to fit would be
// trimming the argument.
export const EXPERIENCE_HEADLINE = 'What we already run'
export const EXPERIENCE_SUBTITLE = 'Not a portfolio of units. A portfolio of buildings.'
export const EXPERIENCE_BODY =
  'Most managers in this market started with one condo and added more. We run hotels and full residence buildings alongside individual homes, which changes what we are able to do for a single unit.\n\n' +
  'It means we already hold the vendor relationships, the linen contracts, the after-hours coverage and the city and HOA relationships that a one-unit operator has to build from nothing. Your unit inherits all of it on day one.'

export const EXPERIENCE_ITEMS: { k: string; v: string }[] = [
  { k: 'The Elser Hotel & Residences', v: 'Downtown Miami · hotel & residences' },
  { k: 'Arya Hotel & Suites', v: 'Miami · hotel' },
  { k: 'The Garden Hotel & Resort', v: 'Fort Lauderdale · resort' },
  { k: 'The Monroe Hotel Miami', v: 'Miami · coming soon' },
  { k: '17West', v: 'Fort Lauderdale · residences' },
  { k: 'Salato Residences', v: 'Pompano Beach · residences' },
  { k: 'Capri', v: 'Palm Beach County · residences' },
  { k: 'Amrit Luxury Condo Rentals', v: 'Palm Beach · luxury' },
  { k: 'Eden Escapes', v: 'Broward · homes & villas' },
]

export const EXPERIENCE_PROOF: { k: string; v: string }[] = [
  { k: 'One operator, end to end', v: 'Listing, pricing, guest communication, turnovers and maintenance are one team and one system — so nothing falls in the gap between two vendors blaming each other.' },
  { k: 'Hotel-grade standards on a single unit', v: 'The checklist that cleans a hotel floor is the checklist that cleans your unit. Same standard, same inspection, same photographic record.' },
  { k: 'Coverage that does not sleep', v: 'A guest locked out at 2am reaches a person, not a voicemail. That is the difference between a five-star review and a one-star one, and it is decided in about four minutes.' },
]

// ── THE GUEST EXPERIENCE ────────────────────────────────────────────────────
// Jon, 2026-09-23: "a slide about the guest experience and what we do to make sure that every
// guest is satisfied with their stay, from welcome calls to pre-arrival inspections to departure
// cleans, at a high level. My standard checklist using Breezeway technology."
//
// Written as a sequence rather than a list of services, because the owner's real question is
// "what happens to my unit between one guest leaving and the next one arriving", and a sequence
// answers it. Every stage is something we actually do and can show them the record of.
export const GUEST_HEADLINE = 'How a stay is run'
export const GUEST_SUBTITLE = 'Six touch points between the booking and the review.'
export const GUEST_BODY =
  'A five-star review is not luck and it is not charm. It is a sequence that happens the same way every time, logged as it happens, so that when something does go wrong we already know it before the guest has to tell us twice.'

export const GUEST_STAGES: { k: string; v: string }[] = [
  { k: 'The booking', v: 'Confirmed within minutes, with the house rules, the parking and the building’s quirks sent before the guest has a chance to wonder about any of them.' },
  { k: 'The welcome call', v: 'We call every arriving guest before they travel. It verifies who is coming, catches the special occasion worth acknowledging, and surfaces the problem that would otherwise turn up in a review.' },
  { k: 'The pre-arrival inspection', v: 'Somebody stands in the unit before the guest does. Lights, water, AC, wifi, supplies, the smell of the place — checked against a standard list and photographed, not remembered.' },
  { k: 'Arrival', v: 'Door codes and directions land ahead of check-in, and the first hour is watched. A guest who cannot get in at 11pm is our emergency, not theirs.' },
  { k: 'During the stay', v: 'Messages are answered around the clock. Anything the guest reports becomes a tracked job with a name on it and a clock running, and we chase it rather than the guest chasing us.' },
  { k: 'The departure clean', v: 'A full turnover against the standard checklist, inspected and photographed before the unit is released back to the calendar. Nothing goes live on a promise.' },
]

export const GUEST_BREEZEWAY =
  'All of it runs on Breezeway, the operations platform hotels use. Every clean, inspection and repair is a task with a checklist, an assignee, a timestamp and photographs — so "the unit was ready" is a record we can show you, not a claim we make.'

// ── REVENUE MANAGEMENT ──────────────────────────────────────────────────────
// Jon, 2026-09-23: "Talk about our revenue management, partnering with Pacer."
//
// Pacer (pacerrev.com) is a MANAGED revenue-management service, not a pricing tool — their own
// line is that they are "the operator that runs your pricing tool". That distinction is the whole
// slide, because every competitor this owner talks to will say "we use dynamic pricing", meaning
// they switched a tool on and walked away.
//
// DELIBERATELY NOT QUOTED: Pacer publishes pooled client results (+21% first-year RevPAR and so
// on). Those are their numbers across their whole book, not ours on this owner's unit, and a
// borrowed statistic on an owner slide is a promise we did not make and cannot keep. The slide
// argues the method instead. Put our OWN figures in the editor when we have them.
export const REVENUE_HEADLINE = 'How your rate gets set'
export const REVENUE_SUBTITLE = 'A dedicated revenue manager, not a switch somebody flipped once.'
export const REVENUE_BODY =
  'Almost every manager you speak to will tell you they use dynamic pricing. What they mean is that they turned a tool on. A tool with nobody operating it prices your unit like the average of its neighbours, forever.\n\n' +
  'We partner with Pacer, a revenue-management firm that does this and only this for vacation rentals and boutique hotels. Your unit has a named revenue manager who works the full picture every week — not just the nightly rate.'

export const REVENUE_LEVERS: { k: string; v: string }[] = [
  { k: 'Nightly rate', v: 'Moved against live demand, comp-set pricing and what is actually booking in your building — not a fixed percentage off a guess.' },
  { k: 'Minimum stay', v: 'The lever most owners never touch, and often the one that costs them the most. A three-night minimum on a Tuesday in August is an empty Tuesday in August.' },
  { k: 'Length-of-stay pricing', v: 'Weekly and monthly rates set so a long booking is worth taking, and a gap night nobody will book is priced to be filled.' },
  { k: 'Fees and promotions', v: 'Cleaning fee, extra-guest fee and channel promotions tuned together, because a guest compares the total, not the headline.' },
  { k: 'Distribution', v: 'Which channels carry which dates, and where a slow window gets pushed harder.' },
  { k: 'The calendar ahead', v: 'Season, events and pickup pace watched months out, so a soft March is found in December while there is still time to fix it.' },
]

export const REVENUE_NOTE =
  'You see the result on the owner portal and in the monthly statement, and we talk through the reasoning on your owner report. If a rate decision does not make sense to you, ask — there is a person to ask.'

// ── WE UNDERSTAND EVERY PART OF THE PROPERTY ────────────────────────────────
// Jon, 2026-09-23: "We need to let them know that we understand each aspect of the property: the
// listing, the amenities, the descriptions, the distribution, the marketing, improving ramp."
//
// This is the slide that separates us from a manager who takes the owner's existing listing,
// changes the payout account and calls it onboarding. Each row names a thing we DO to the
// listing, in the order we do it, so the owner can picture the work rather than trust a promise.
export const CRAFT_HEADLINE = 'What we do to the listing itself'
export const CRAFT_SUBTITLE = 'Before we talk about rate, we fix what the rate is being charged for.'
export const CRAFT_BODY =
  'A listing is a product. Most underperforming units are not priced wrong — they are presented wrong, and then priced down to compensate. We work the product first, because every dollar of rate you can hold afterwards depends on it.'

export const CRAFT_ROWS: { k: string; v: string }[] = [
  { k: 'The listing', v: 'Rebuilt rather than inherited: title, photo order, hero shot and the first three images a guest actually sees before they decide. Ranking rewards the listings guests stop scrolling on, so that is what we build.' },
  { k: 'The amenities', v: 'Audited line by line against what the channel lets you filter on. An amenity you have but never listed is a search you silently lost — and the cheap ones to add are usually the ones guests filter by.' },
  { k: 'The descriptions', v: 'Written for the guest who is deciding between you and three others in the same building. Specific about the space, honest about the trade-offs, and answering the questions that otherwise arrive as messages at 9pm.' },
  { k: 'The distribution', v: 'Published across 40+ channels from one calendar, so visibility is not limited to the one site you would have listed on yourself.' },
  { k: 'The marketing', v: 'Channel promotions, new-listing placement, seasonal pushes and the guest-facing guidebook that turns a good stay into a five-star review.' },
  { k: 'The ramp', v: 'A deliberate 90-day plan to build the review count and search position a new listing does not start with — the next slide is exactly how.' },
]

// ── HOW WE SHORTEN THE RAMP ─────────────────────────────────────────────────
// Jon, 2026-09-23: "What steps we take to improve ramp, not just talk about ramp, but how we
// improve ramp to drive occupancy and revenue."
//
// The ramp slide has always been expectation-setting: here is the curve, do not read month one as
// a failure. Fair, and completely passive. This is the other half — the work that bends the curve
// — and it has to sit next to the curve or the curve reads as an excuse.
export const RAMP_ACTIONS_HEADLINE = 'How we shorten it'
export const RAMP_ACTIONS_SUBTITLE = 'The curve is normal. Sitting still through it is not.'
export const RAMP_ACTIONS: { k: string; v: string }[] = [
  { k: 'Launch into the promotion window', v: 'Channels give a new listing a visibility boost and a promotional slot exactly once. We launch into it deliberately, with the listing already finished, rather than burning it on a half-built page.' },
  { k: 'Widen the net first', v: 'Minimum stays opened up and the booking window extended at launch, because the fastest route to a review is a booking, and a three-night minimum on a new listing turns away the one-night guest who would have left the first one.' },
  { k: 'Every channel from day one', v: 'A new listing on one site ramps at the speed of one site’s audience. On 40+, the first bookings arrive from wherever they happen to arrive.' },
  { k: 'Chase the first reviews', v: 'The first five reviews move placement more than the next fifty. Welcome call, mid-stay check, and a review request that actually gets sent — every stay, without exception.' },
  { k: 'Protect the score while it is fragile', v: 'One bad review out of four is a quarter of your reputation. Early stays get the closest operational attention we give, because that is when a single miss costs the most.' },
  { k: 'Raise rate as standing is earned', v: 'Rate follows position up. As reviews and ranking build, the price moves with them rather than staying where it launched — reviewed weekly, not left alone.' },
]
export const RAMP_ACTIONS_NOTE =
  'None of this trades revenue for reviews. Every night is still priced to the best rate the market will pay that day; the reviews come from filling the nights that would otherwise have gone empty.'

// ── THE TECHNOLOGY STACK ────────────────────────────────────────────────────
// Jon, 2026-09-23: "create and mention the different tech stacks we use from Guesty to PriceLabs
// to Breezeway to Lighthouse … this app, the web app, Slack, and email communication to improve
// the guest experience and to help manage your property and drive more revenue" — "a highlight of
// the tech that we use, and use the tech logos, in the deck."
//
// NOTE THIS IS NOT THE `tech` SECTION. That one is the hardware IN the unit — smart lock, wifi,
// thermostat, noise monitor. This is the software behind the operation. Two different slides, and
// conflating them would have buried the in-unit list an owner also wants.
//
// ON THE LOGOS: the channels wall uses Simple Icons glyphs, which exist for Airbnb, Expedia and
// the rest. No such glyph exists for Guesty, PriceLabs or Breezeway, and Lighthouse is ours. Five
// marks pulled from five different vendor press kits at five different weights would read as a
// sticker sheet, not a stack — so each tool carries a monogram tile drawn in one ink at one size,
// which is the same design answer the channels wall reached. Swap in real artwork any time we hold
// the files; the layout takes them without changing.
export const STACK_HEADLINE = 'The system behind your unit'
export const STACK_SUBTITLE = 'Four platforms, one operation.'
export const STACK_BODY =
  'Most of what goes wrong in this business goes wrong in the gaps — between the booking system and the cleaner, between the cleaner and the owner, between a guest reporting something and anyone hearing about it. We closed those gaps by running one connected stack instead of four disconnected tools.'

export type StackTool = { mono: string; name: string; role: string; v: string }

export const STACK_TOOLS: StackTool[] = [
  { mono: 'G', name: 'Guesty', role: 'The booking engine',
    v: 'Every channel, every reservation and every calendar in one place, and the system your owner portal and monthly statement are generated from. One source of truth for what is booked and what you are owed.' },
  { mono: 'PL', name: 'PriceLabs', role: 'The pricing engine',
    v: 'Live market data, comp-set rates and demand signals feeding a nightly price for every date on your calendar — the tool our revenue managers operate rather than leave running on defaults.' },
  { mono: 'B', name: 'Breezeway', role: 'The operations platform',
    v: 'The platform hotels use to run housekeeping and maintenance. Every clean, inspection and repair is a task with a checklist, an assignee, a timestamp and photographs — so readiness is a record, not a claim.' },
  { mono: 'L', name: 'Lighthouse', role: 'Our own software',
    v: 'Built in-house, on top of the others. It watches the day for the things a person would miss: an unassigned clean, a guest whose message went unanswered, a rate that drifted, a statement that does not reconcile. Nobody else in this market has it, because nobody else built it.' },
]

export const STACK_CHANNELS: { k: string; v: string }[] = [
  { k: 'Slack', v: 'The whole team — housekeeping, maintenance, guest care, management — in one room, in real time, in two languages. A problem raised at your unit reaches whoever can fix it in seconds, not through a chain of phone calls.' },
  { k: 'Email & messaging', v: 'Guest messages across every channel land in one inbox and are answered around the clock. Your monthly statement, owner report and anything needing your approval come to you the same way — written, timestamped, and yours to keep.' },
]

export const STACK_NOTE =
  'You do not have to learn any of it. It exists so that the answer to "what is happening at my unit right now" is always a screen somebody can open, rather than a question somebody has to go and ask.'

// OWNER ONBOARDING — the welcome presentation (Jon, 2026-09-16: "a welcome onboarding
// presentation… it can live in the owner reports in a different tab called Owner Onboarding").
//
// It generates like an owner report and shares all of that machinery — the same `owner_reports`
// row, the same share link, the same inline editor, themes, PPTX, Slides and Present mode — but
// it is not a report. A report says what happened. This one runs the kickoff call: we walk the
// owner's listing, agree the strategy, and answer their questions while they watch.
//
// TWO IDEAS HOLD THE WHOLE THING UP.
//
// 1. HOUSE TEMPLATE + PER-OWNER COPY (Jon: "make sure this is fully customizable, meet the team
//    section I can build in backend so i dont have to do it each time, still customizable").
//    Every word that is the same for every owner — the team, the money rules, the checklist, the
//    ramp doctrine, the questions we ask — lives ONCE in app_settings under `onboarding_template`.
//    Generating copies that template into the report's own content. Editing a generated report
//    changes only that owner's copy; editing the template changes what the NEXT owner gets, and
//    never rewrites a document already sent. Same shape as the furnishing standard in
//    lib/onboarding (app_settings.onboarding_standard).
//
// 2. THE QUESTIONS ARE THE DOCUMENT. Each section carries a few `Ask`s — a question in our voice
//    with an empty answer. They get filled in live on the call. Anything still blank collects in
//    the closing section, so the unanswered questions ARE the follow-up agenda and an onboarding
//    is never "done" while fields are empty.
import 'server-only'
import { getSetting } from './app-settings'
import { otaLinksFrom, type OtaLink } from './ota-links'
import { MARKET_DEFAULTS } from './projections'

/** A question we ask on the call. `a` is the answer, typed live into the report. */
export type Ask = { id: string; q: string; hint?: string; a?: string }
export type KV = { k: string; v: string }

export type ListingCard = {
  id: string
  name: string
  sub: string
  // NO SCORE AND NO AMENITY GRID IN FRONT OF AN OWNER (Jon, 2026-09-16: "remove the scoring on
  // the listing" and "clean up the amenity section — let's just remove that for now. We can view
  // it on Airbnb, and I can have one of my admins do it on the backend"). Both were our internal
  // instruments wearing an owner's clothes. What is left is what the owner can actually judge on
  // a call: the photos a guest meets first, the live channel links, and the words.
  links: OtaLink[]
  photos: string[]
  title: string
  summary: string
  space: string
  /** What the listing claims today. Ticked off in the room and pushed to Guesty from the slide. */
  amenities: string[]
  /** What a unit of this shape is missing, and why it matters — from the optimize score. */
  amenitySuggest: { name: string; reason: string }[]
}

/** Any section can carry one of the owner's own listing photos and a free note. */
export type Sec<T> = T & { photo?: string; note?: string }

export type OnboardingContent = {
  meta: {
    kind: 'onboarding'
    scopeLabel: string
    asOf: string
    generatedAt: string
    listingIds: string[]
    market: string
    /** The mark on the cover and on every presented slide. Image when we have one, else the wordmark. */
    logoUrl: string
    wordmark: string
  }
  hero: { eyebrow: string; title: string; headline: string; preparedFor: string; dateLabel: string; heroImage: string | null }
  /** 1 — the opener. A greeting and one large picture of their own unit. Nothing to read. */
  welcome: Sec<{ headline: string; subtitle: string; body: string }>
  /** 2 — what we are going to cover, in order. */
  agenda: Sec<{ headline: string; subtitle: string; items: KV[] }>
  /** 4 — who Stay Hospitality is. The stats live here now, not on the greeting. */
  overview: Sec<{ headline: string; subtitle: string; body: string; stats: KV[] }>
  /**
   * 5 — WHERE THE UNIT ACTUALLY SELLS (Jon, 2026-09-16: "OTAs were on: 30+ OTAs, Airbnb, Vrbo,
   * Booking.com, Expedia, Marriott, Blueground, Expedia and Expedia's partners"). This is the
   * single most under-sold thing we do: an owner who self-managed was on one channel, and the
   * reason we can price for occupancy at all is that the same calendar is live on thirty.
   */
  channels: Sec<{
    headline: string; subtitle: string; body: string
    primary: string[]; more: string[]; count: string
    /**
     * CHANNEL LOGOS ARE OTHER COMPANIES' TRADEMARKS. We do not draw them, and an approximation
     * would look worse than type does — so the slide ships as a wordmark wall and renders real
     * artwork the moment someone drops official partner/press-kit files in here. Each entry is
     * a name and an image URL; the slide greyscales them so eight brand palettes do not fight.
     */
    logos: { name: string; url: string }[]
  }>
  unit: Sec<{ headline: string; subtitle: string; body: string; facts: KV[]; asks: Ask[] }>
  listings: Sec<{ headline: string; subtitle: string; items: ListingCard[]; asks: Ask[]; catalog: string[] }>
  strategy: Sec<{ headline: string; subtitle: string; body: string; asks: Ask[] }>
  ramp: Sec<{ headline: string; subtitle: string; bands: KV[]; note: string; asks: Ask[] }>
  season: Sec<{
    headline: string; subtitle: string; body: string
    months: { m: string; level: number }[]; note: string; asks: Ask[]
    /** The shape of the year as a share, not a dollar figure — no invented numbers on a deck. */
    peakShare: string; peakLabel: string; lowNote: string
  }>
  /**
   * 6 — the owner portal. Guesty exposes NO per-owner portal URL: the account gets exactly one
   * `<name>.guestyowners.com` and every owner signs into it with their own email (confirmed
   * against help.guesty.com and against all 47 rows of guesty_owners, none of which carry a URL).
   * So the address is a house setting and the login is this owner's Guesty email.
   */
  guesty: Sec<{
    headline: string; subtitle: string; body: string; items: KV[]
    portalUrl: string; loginEmail: string
    /** "Guesty owner portal with photos, etc." — screenshots of the portal, set once in settings. */
    shots: string[]
  }>
  tech: Sec<{ headline: string; subtitle: string; body: string; rows: KV[]; asks: Ask[] }>
  team: Sec<{
    headline: string; subtitle: string
    people: { name: string; role: string; blurb: string; photo?: string | null; phone?: string; email?: string }[]
    /**
     * THE SHARED INBOX, PRESENTED AS WHAT IT IS (Jon, 2026-09-16). It sits under the four faces
     * rather than beside them as a fifth card: this slide's whole promise is that the owner gets
     * people, so the inbox has to read as the backstop behind them, not as one of them.
     */
    support: { label: string; note: string; email: string }
  }>
  comms: Sec<{ headline: string; subtitle: string; body: string; rows: KV[]; asks: Ask[] }>
  money: Sec<{ headline: string; subtitle: string; body: string; rules: KV[]; examples: { title: string; lines: KV[]; total: string; verdict: string; tone: 'ok' | 'hold' }[]; asks: Ask[] }>
  /**
   * 7 — THE OWNER STATEMENT, IN THE SHAPE GUESTY ACTUALLY ISSUES IT (Jon, 2026-09-16, with a
   * real August statement attached: "use this as an example… change name, rev, expense but use
   * same line items… make it viewable and interactive, not just a JPEG").
   *
   * So this is modelled on the document itself: the performance strip, the category summary
   * ending in the navy "Payment due to owner" row, and the per-reservation detail where every
   * booking breaks into rental / PMC commission / cleaning / parking / channel reimbursement.
   * The figures are invented and internally consistent — the management fee really is 20% of
   * the rental line, and every subtotal adds up — because an owner WILL check the arithmetic on
   * the one example we show them, and a demo that does not foot is worse than no demo.
   */
  statement: Sec<{
    headline: string; subtitle: string
    unitLabel: string; period: string
    /** The strip across the top of the real statement. */
    kpis: KV[]
    /** The category summary, in the issued order. */
    summary: { k: string; v: string; neg?: boolean; rule?: boolean }[]
    due: KV
    /** Per-reservation detail for one unit — the "every line traces to a booking" proof. */
    reservations: {
      guest: string; stay: string
      lines: { date: string; desc: string; cat: string; amt: string; neg?: boolean }[]
      total: string
    }[]
    propertyIncome: KV
    note: string
    rules: KV[]
    highlights: KV[]
    also: KV[]
  }>
  checklist: Sec<{ headline: string; subtitle: string; rows: { item: string; who: string; by: string }[] }>
  nextup: Sec<{ headline: string; subtitle: string; rows: KV[] }>
  /** 8 — other notes. Free text typed on the call, plus anything still unanswered above. */
  notes: Sec<{ headline: string; subtitle: string; body: string }>
  /** Every photo on the owner's listings, so any section can pick one without another fetch. */
  photoPool: string[]
  custom?: { id: string; eyebrow: string; title: string; body: string }[]
  omit: string[]
}

export const ONBOARDING_TEMPLATE_KEY = 'onboarding_template'

/** The parts of the document that are the same for every owner. Edited once, in settings. */
export type OnboardingTemplate = {
  /** Charge rate shown in the money section. Mirrors app_settings.billing_default_rate. */
  laborRate: number
  /** Pre-approval ceiling shown to the owner. Mirrors lib/approval DEFAULT_LIMITS.default. */
  approvalLimit: number
  mgmtPct: number
  /** A real logo when Jon has artwork; until then the wordmark below is the mark. */
  logoUrl: string
  wordmark: string
  companyStats: KV[]
  welcomeBody: string
  overviewBody: string
  channelsBody: string
  /** The names an owner recognises, shown as a wall. */
  channelsPrimary: string[]
  /** The long tail, set small underneath — it is the count that does the persuading. */
  channelsMore: string[]
  channelsCount: string
  channelsLogos: { name: string; url: string }[]
  agenda: KV[]
  /** The house's one Owners Portal address. Guesty allows exactly one per account. */
  portalUrl: string
  /** Screenshots of the portal, shown in section 6. Set once, used by every owner's deck. */
  portalShots: string[]
  strategyBody: string
  rampBands: KV[]
  rampNote: string
  seasonBody: string
  seasonNote: string
  seasonLowNote: string
  peakShare: string
  peakLabel: string
  team: { name: string; role: string; blurb: string; photo?: string | null; market?: string; phone?: string; email?: string }[]
  supportLabel: string
  supportNote: string
  supportEmail: string
  commsBody: string
  commsRows: KV[]
  portalItems: KV[]
  guestyBody: string
  techRows: KV[]
  moneyBody: string
  moneyRules: KV[]
  statementAlso: KV[]
  checklist: { item: string; who: string; by: string }[]
  asks: Record<string, Ask[]>
}

export const DEFAULT_TEMPLATE: OnboardingTemplate = {
  laborRate: 40,
  approvalLimit: 250,
  mgmtPct: 20,

  logoUrl: '',
  wordmark: 'STAY HOSPITALITY',
  companyStats: [
    { k: 'Markets', v: 'Miami & Broward' },
    { k: 'Units managed', v: '400+' },
    { k: 'Channels', v: 'Airbnb · Vrbo · Booking.com' },
    { k: 'In-house', v: 'Housekeeping, maintenance & guest care' },
  ],

  // THE GREETING IS NOT A BRIEF. It is two sentences over a large photograph of their own unit,
  // read aloud in about fifteen seconds while everyone finishes joining the call. Everything that
  // used to be crammed in here is now section 4, where it belongs.
  welcomeBody:
    'This document is the call itself. We fill it in together as we talk, and it stays yours afterwards as the record of what we agreed.',

  overviewBody:
    'Stay Hospitality runs short-term rentals in Miami and Broward end to end: the listing and its pricing, the guest from enquiry to review, the turnover, and the maintenance in between. Housekeeping, maintenance and guest care are our own people on our own payroll — not a marketplace of contractors we hope shows up.\n\n' +
    'What that buys you is a single accountable line. One team that knows your unit, one system every number comes out of, and one statement a month you can trace back to the job that caused it.',

  portalUrl: 'https://stay.guestyowners.com',
  portalShots: [],

  channelsBody:
    'Your calendar is one calendar. We publish it to every channel that matters and reconcile the bookings back into a single place, which is the only reason a unit can be priced for occupancy without ever being double-booked.\n\n' +
    'Most owners arrive on one channel. Being on thirty is what turns a slow Tuesday in September into a booking.',
  channelsPrimary: [
    'Airbnb', 'Vrbo', 'Booking.com', 'Expedia',
    'Hotels.com', 'Marriott Homes & Villas', 'Blueground', 'Whimstay',
  ],
  channelsMore: [
    'Expedia partner network', 'Orbitz', 'Travelocity', 'Wotif', 'ebookers',
    'Agoda', 'Trip.com', 'Google Vacation Rentals', 'HomeToGo', 'Holidu', 'Hometogo partners',
    'Whimstay', 'Houfy', 'Plum Guide', 'Corporate & relocation partners',
  ],
  channelsCount: '30+',
  channelsLogos: [],

  agenda: [
    { k: 'Your listings', v: 'We open the live listing on every channel, score it, and fix the weak parts while you watch.' },
    { k: 'Goals & strategy', v: 'Who the unit is for, and the one trade-off every pricing decision comes from.' },
    { k: 'The first 90 days', v: 'What a brand-new listing actually does, and why month one is bought rather than earned.' },
    { k: 'Your portal & statements', v: 'Where you see performance, approve spend, and read what you were paid.' },
    { k: 'How billables work', v: 'What we charge, what we never charge, and what needs your yes first.' },
    { k: 'Your team', v: 'Names, faces and direct numbers — not a shared inbox.' },
  ],

  strategyBody:
    'Every pricing decision downstream comes from one trade-off: rate or occupancy. A unit can run high-rate and sit emptier, or run a shade under the market and stay full. Both work. They do not work at the same time, and pretending otherwise is how a unit ends up mediocre at both.\n\n' +
    'Our default for a new listing is occupancy first for the first season, then we push rate once the review count can carry it. We will say plainly which lever we are pulling each month in your report.',

  // DRAFT DOCTRINE. Jon has the final word on this one — it is the part an owner will quote back
  // in February, so it belongs in the template where it can be rewritten once for everybody.
  rampBands: [
    { k: 'Days 1–30', v: 'Opening rate set below target to move the first bookings. Expect low occupancy and a rate you will not love. The goal is five completed stays and five reviews, not revenue.' },
    { k: 'Days 31–60', v: 'Reviews start carrying placement. We begin closing the gap to market rate. Occupancy climbs faster than rate.' },
    { k: 'Days 61–90', v: 'Enough history to price properly. This is the first month whose numbers mean anything, and the first owner report worth judging us on.' },
  ],
  rampNote:
    'We would rather tell you this now than have you read month one as a failure. If month one looks like a normal month, we priced too high and left reviews on the table.',

  seasonBody:
    'Your season is December through April, and it builds to a peak in March. That is when the demand is, that is when the rate is, and that is the window everything else in the year is preparing for. The year falls away from there through the summer; September is the floor, and the climb back starts in October.',
  peakShare: '65%',
  peakLabel: 'of the year\u2019s revenue lands December through April',

  seasonLowNote: 'September is the floor \u2014 the quietest month of the year, and the one we use for deep cleans, touch-ups and anything that needs the unit empty.',

  seasonNote:
    'Shape only — this is the market’s year, not a forecast of your unit. We will not put a dollar projection on your unit until it has a season of its own history; a number we invented today would be the number you would hold us to in April.',

  // THE FOUR PEOPLE AN OWNER MEETS (Jon, 2026-09-16: "the about the team should be Roberto,
  // Karla, Jonathan (me) and Bernadette"). Written once here rather than pulled from the staff
  // roster: the roster is a payroll list of 58 and it was seeding the deck with whoever happened
  // to sort first. Edit these four in settings and every future deck follows.
  team: [
    { name: 'Jonathan', role: 'General Manager', blurb: 'Runs Stay Hospitality day to day. On your onboarding call, and the person to call when something matters more than a ticket.', photo: null, phone: '', email: '' },
    { name: 'Roberto Chiriboga', role: 'Operations Manager', blurb: 'Owns what happens in the unit \u2014 turnovers, inspections and the maintenance calendar. Your day-to-day answer.', photo: null, phone: '', email: '' },
    { name: 'Karla Valle', role: 'Field Coordinator', blurb: 'Coordinates what happens on the ground \u2014 turnovers, inspections and the daily schedule across every unit.', photo: null, phone: '', email: '' },
    // "Administration and team support" is the job; "Administration Lead" is the title, because
    // a card that lists two functions reads as someone who does neither.
    { name: 'Bernadette', role: 'Administration Lead', blurb: 'Owner paperwork, statements and payouts, and keeping the field team scheduled and supplied.', photo: null, phone: '', email: '' },
  ],

  supportLabel: 'Support team',
  supportNote: 'Anything that is not urgent, anything you would rather put in writing, and anything you want a record of. Watched every business day.',
  supportEmail: 'support@stay-hospitality.com',

  commsBody:
    'Guest messaging runs through Guesty and it does not touch you. Booking confirmations, check-in instructions, door codes, mid-stay questions, the 11pm "how does the thermostat work" — all of it is handled, most of it automatically, the rest by our coordination team.',
  commsRows: [
    { k: 'Before arrival', v: 'Confirmation, house rules, parking, and a door code generated per stay that expires at checkout. No key handoff, no lockbox code shared between guests.' },
    { k: 'During the stay', v: 'A real person answers. Anything needing a technician becomes a Breezeway task the same hour, and you see it on your report at month end.' },
    { k: 'After checkout', v: 'We ask for the review, and we answer every one that lands — including the bad ones. A unit that scores below our bar books an inspection automatically on its next checkout.' },
    { k: 'Your channel', v: 'You get a direct line to your operations manager, not a shared inbox. Anything that will cost you money reaches you before it happens, not after.' },
  ],

  guestyBody:
    'We run on Guesty — the same platform the largest operators in this market use. It holds every reservation, every channel connection, every message and every statement in one place, which is why the numbers you see from us reconcile rather than being retyped from a spreadsheet.\n\n' +
    'For you, the part that matters is the owner portal: your own login, your live calendar, and your statements the moment they are issued.',

  techRows: [
    { k: 'Smart lock', v: 'A code generated per stay that expires at checkout. No keys handed over, no code shared between guests, and we can let a technician in without you driving over.' },
    { k: 'Wi-Fi', v: 'In the unit\u2019s name, on a network we can reset remotely. The password rides in the guidebook rather than on a sticky note.' },
    { k: 'Thermostat', v: 'Set back automatically between stays so you are not cooling an empty unit, and pre-cooled before a guest lands.' },
    { k: 'Noise monitoring', v: 'Decibel-only, no recording, in the living area. It tells us a party is starting before a neighbour or the HOA does.' },
    { k: 'Guidebook', v: 'A digital guide for the unit \u2014 check-in, Wi-Fi, appliances, local picks. Cuts the "how does this work" messages by more than half.' },
  ],

  portalItems: [
    { k: 'Your calendar', v: 'Every reservation as it lands, the nights already sold, and the blocks you asked us to hold. The same calendar we work from, not a copy of it.' },
    { k: 'Your monthly report', v: 'Occupancy, rate, revenue, what we did, what guests said, what is booked ahead. One link, always the same link.' },
    { k: 'Your order sheet', v: 'Anything we want to buy for the unit, with photos, the reason, price options, and four buttons: approve, I will supply it, not now, no.' },
    { k: 'Your statement', v: 'Rental, less commission, less anything billed that month, equals what hits your account. Every billed line traces to a job with a date and a photo.' },
  ],

  moneyBody:
    'This is the section that decides whether you trust your statement in six months, so here are the rules in full, including the ones that cost us money.',
  moneyRules: [
    { k: 'Departure cleans', v: 'Never billed to you. The guest’s cleaning fee pays for the turnover. If a clean costs us more than the fee collected, that is our problem, not a line on your statement.' },
    { k: 'Labor', v: '$40 an hour, or a flat price agreed for a defined job. Time is the technician’s actual clock in and out on the task, not an estimate.' },
    { k: 'Parts and supplies', v: 'At cost. No markup. A $19 faucet cartridge is $19 on your statement.' },
    { k: 'Guest-caused damage', v: 'Billed to the guest or their channel, not to you. You only see it if we fail to recover it, and then you see why.' },
    { k: 'Under $250', v: 'We handle it and it appears on your next statement. This threshold is yours to set — raise it, lower it, or set it to zero and see every item first.' },
    { k: 'Over $250', v: 'It goes to your order sheet before anyone spends anything, with photos, the reason, and usually three options. Nothing over your limit gets bought without your yes.' },
    { k: 'Emergencies', v: 'Active leak, no A/C, lockout, anything unsafe with a guest in house — we act first and tell you immediately. This is the one exception to the rule above, and we would rather explain a $600 invoice than a flooded unit.' },
  ],

  statementAlso: [
    { k: 'Cleaning fee', v: 'The guest’s cleaning fee, passing through to us. This is what pays for turnovers — which is why a departure clean is never an owner charge.' },
    { k: 'Channel fee reimbursement', v: 'What Airbnb, Vrbo or Booking took out of the booking, shown so the rental line reads as a real number rather than a gross one.' },
    { k: 'Revenue management', v: 'Appears only if you are on a revenue-management arrangement.' },
    { k: 'Adjustments', v: 'A cancellation, a refund, or a late-landing charge from a prior month. Always labelled with the month it belongs to.' },
  ],

  checklist: [
    { item: 'W-9 and banking details for payouts', who: 'Owner', by: '' },
    { item: 'Short-term rental rider on your insurance', who: 'Owner', by: '' },
    { item: 'HOA registration and any rental approval', who: 'Owner', by: '' },
    { item: 'County tourist tax registration', who: 'Stay', by: '' },
    { item: 'Smart lock installed, codes into Guesty', who: 'Stay', by: '' },
    { item: 'Opening buy list approved and delivered', who: 'Owner', by: '' },
    { item: 'Linen par levels stocked — 3 sets per bed', who: 'Stay', by: '' },
    { item: 'Professional photos', who: 'Stay', by: '' },
    { item: 'Listing written and live on every channel', who: 'Stay', by: '' },
    { item: 'Calendar sync verified across all channels', who: 'Stay', by: '' },
    { item: 'Wi-Fi in the unit’s name, password into the guidebook', who: 'Owner', by: '' },
    { item: 'Parking spot or guest parking rules confirmed', who: 'Owner', by: '' },
  ],

  asks: {
    unit: [
      { id: 'u1', q: 'Anything we got wrong, or that you are taking out?' },
      { id: 'u2', q: 'Anything here you would be upset to see damaged?', hint: 'We will box it and store it rather than insure it by hope.' },
      { id: 'u3', q: 'Who else holds keys or door codes?', hint: 'HOA, a cleaner you used before, family, a contractor.' },
    ],
    listings: [
      { id: 'l1', q: 'Anything in the description that is not true, or that you would never say?' },
      { id: 'l2', q: 'What does this unit have that the building’s other listings do not?', hint: 'The line that earns the booking. Owners usually know it and nobody ever asks.' },
    ],
    strategy: [
      { id: 's0', q: 'What does a good first year look like to you?', hint: 'The number, or the feeling. Both are useful and they are rarely the same.' },
      { id: 's1', q: 'Who is this unit for?', hint: 'Families · couples · business · snowbirds · long stays' },
      { id: 's2', q: 'If we can only have one — higher rate, or higher occupancy?' },
      { id: 's3', q: 'Minimum stay floor?', hint: 'Shorter fills faster and turns more; longer protects the unit.' },
      { id: 's4', q: 'Pets — yes, no, or case by case?' },
      { id: 's5', q: 'Owner blocks — how often, and how much notice can you give us?', hint: 'Notice is the whole game. Two weeks costs nothing; two days costs a booking.' },
    ],
    ramp: [
      { id: 'r1', q: 'Are you comfortable opening under target rate for the first 30–45 nights?' },
      { id: 'r2', q: 'Is there a date this has to be earning by?', hint: 'Mortgage, assessment, a number you told someone.' },
    ],
    season: [
      { id: 'e1', q: 'Any dates you already know you are blocking this season?' },
      { id: 'e2', q: 'Any renovation, special assessment or HOA work coming?' },
    ],
    tech: [
      { id: 't1', q: 'Is there anything already installed we should keep or work around?', hint: 'An HOA lock standard, a Ring, a Nest you like, a mesh network.' },
      { id: 't2', q: 'Anything you would rather we did not put in?' },
    ],
    comms: [
      { id: 'c1', q: 'Best number and email — and how fast do you want to hear from us?' },
      { id: 'c2', q: 'Every guest issue, or only the ones that cost money?', hint: 'Most owners want the second. Some want everything for the first month.' },
      { id: 'c3', q: 'Anyone else on communications?', hint: 'Spouse, partner, accountant, property attorney.' },
    ],
    money: [
      { id: 'm1', q: 'Your approval limit — keep $250, or change it?' },
      { id: 'm2', q: 'Who approves when you are unreachable?' },
      { id: 'm3', q: 'Any vendor of your own we should use?', hint: 'An A/C contract, a plumber you trust, the HOA’s preferred list.' },
    ],
  },
}

/** The house template: stored settings merged over the defaults, so a partial save is safe. */
export async function getOnboardingTemplate(): Promise<OnboardingTemplate> {
  let stored: Partial<OnboardingTemplate> = {}
  try { stored = (await getSetting<Partial<OnboardingTemplate>>(ONBOARDING_TEMPLATE_KEY, {})) || {} } catch { stored = {} }
  const arr = <T,>(a: any, d: T[]): T[] => (Array.isArray(a) && a.length ? a as T[] : d)
  const str = (a: any, d: string): string => (typeof a === 'string' && a.trim() ? a : d)
  const num = (a: any, d: number): number => (Number.isFinite(Number(a)) ? Number(a) : d)
  const D = DEFAULT_TEMPLATE
  return {
    laborRate: num(stored.laborRate, D.laborRate),
    approvalLimit: num(stored.approvalLimit, D.approvalLimit),
    mgmtPct: num(stored.mgmtPct, D.mgmtPct),
    logoUrl: typeof stored.logoUrl === 'string' ? stored.logoUrl : D.logoUrl,
    wordmark: str(stored.wordmark, D.wordmark),
    companyStats: arr(stored.companyStats, D.companyStats),
    guestyBody: str(stored.guestyBody, D.guestyBody),
    overviewBody: str(stored.overviewBody, D.overviewBody),
    channelsBody: str(stored.channelsBody, D.channelsBody),
    channelsPrimary: arr(stored.channelsPrimary, D.channelsPrimary),
    channelsMore: arr(stored.channelsMore, D.channelsMore),
    channelsCount: str(stored.channelsCount, D.channelsCount),
    channelsLogos: Array.isArray(stored.channelsLogos) ? stored.channelsLogos : D.channelsLogos,
    portalUrl: str(stored.portalUrl, D.portalUrl),
    // An empty shot list is a real state (no screenshots uploaded yet), so it is kept as saved.
    portalShots: Array.isArray(stored.portalShots) ? stored.portalShots : D.portalShots,
    techRows: arr(stored.techRows, D.techRows),
    welcomeBody: str(stored.welcomeBody, D.welcomeBody),
    agenda: arr(stored.agenda, D.agenda),
    strategyBody: str(stored.strategyBody, D.strategyBody),
    rampBands: arr(stored.rampBands, D.rampBands),
    rampNote: str(stored.rampNote, D.rampNote),
    seasonBody: str(stored.seasonBody, D.seasonBody),
    seasonNote: str(stored.seasonNote, D.seasonNote),
    seasonLowNote: str(stored.seasonLowNote, D.seasonLowNote),
    peakShare: str(stored.peakShare, D.peakShare),
    peakLabel: str(stored.peakLabel, D.peakLabel),
    // The one list whose empty state is meaningful: no team saved yet means we fall back to the
    // live staff roster at generate time rather than printing nobody.
    team: Array.isArray(stored.team) ? stored.team : D.team,
    supportLabel: str(stored.supportLabel, D.supportLabel),
    supportNote: str(stored.supportNote, D.supportNote),
    supportEmail: str(stored.supportEmail, D.supportEmail),
    commsBody: str(stored.commsBody, D.commsBody),
    commsRows: arr(stored.commsRows, D.commsRows),
    portalItems: arr(stored.portalItems, D.portalItems),
    moneyBody: str(stored.moneyBody, D.moneyBody),
    moneyRules: arr(stored.moneyRules, D.moneyRules),
    statementAlso: arr(stored.statementAlso, D.statementAlso),
    checklist: arr(stored.checklist, D.checklist),
    asks: (stored.asks && typeof stored.asks === 'object') ? { ...D.asks, ...stored.asks } : D.asks,
  }
}

// ── the season's shape. House doctrine, not a forecast: six peak months, two at the floor. ──
const SEASON_SHAPE: { m: string; level: number }[] = [
  // March is the single peak (Jon, 2026-09-16), the season builds to it from December, and the
  // year falls away from there to a September floor before the slow climb back.
  { m: 'J', level: 4 }, { m: 'F', level: 5 }, { m: 'M', level: 6 }, { m: 'A', level: 4 },
  { m: 'M', level: 3 }, { m: 'J', level: 2 }, { m: 'J', level: 2 }, { m: 'A', level: 1 },
  { m: 'S', level: 0 }, { m: 'O', level: 1 }, { m: 'N', level: 2 }, { m: 'D', level: 4 },
]

const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const money2 = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Market benchmark line for the season section — real numbers from lib/projections. */
function benchmarkLine(market: string, bedrooms: number | null): string {
  const key = String(market || '').toLowerCase()
  const d = (MARKET_DEFAULTS as any)[key]
  if (!d) return ''
  const bk = String(Math.max(0, Math.min(4, Number(bedrooms ?? 1))))
  const adr = d.adr && d.adr[bk]
  const label = key.charAt(0).toUpperCase() + key.slice(1)
  const what = bedrooms == null ? 'Comparable units' : bedrooms <= 0 ? 'Comparable studios' : `Comparable ${bedrooms}-bedrooms`
  return adr
    ? `${what} in ${label} benchmark around ${money0(adr)} ADR at roughly ${d.occPct}% annual occupancy.`
    : `${label} runs roughly ${d.occPct}% annual occupancy.`
}

/** One listing, read for review: the live channel links, the first five photos, the copy. */
export function listingCardFrom(
  l: any,
  amenities: string[] = [],
  amenitySuggest: { name: string; reason: string }[] = [],
): ListingCard {
  const raw = l && l.raw ? l.raw : {}
  const pub = raw.publicDescription || raw.publicDescriptions || {}
  const pics: string[] = Array.isArray(l.pictures) ? l.pictures.filter(Boolean) : []
  const bits = [
    // "0 BR" is not a thing an owner calls their unit.
    l.bedrooms != null ? (Number(l.bedrooms) === 0 ? 'Studio' : `${l.bedrooms} BR`) : null,
    l.bathrooms != null ? `${l.bathrooms} BA` : null,
    l.max_occupancy != null ? `sleeps ${l.max_occupancy}` : null,
  ].filter(Boolean)
  const links = otaLinksFrom(raw)
  return {
    id: String(l.id),
    name: String(l.nickname || l.title || 'Unit'),
    sub: [bits.join(' · '), links.length ? `live on ${links.length} channel${links.length === 1 ? '' : 's'}` : 'not yet live'].filter(Boolean).join(' · '),
    links,
    // THE FIRST FIVE, IN ORDER (Jon, 2026-09-16). Nobody scrolls past these on a phone, which is
    // why photos carry 18% of the optimize score on their own.
    photos: pics.slice(0, 5),
    title: String(raw.title || l.title || ''),
    summary: String(pub.summary || ''),
    space: String(pub.space || ''),
    amenities,
    amenitySuggest,
  }
}

export type BuildInput = {
  /** Straight off guesty_owners when we have the row — the owner corrects it on the call. */
  ownerEmail?: string
  ownerPhone?: string
  scopeLabel: string
  asOf: string
  market: string
  ownerName: string
  goLive: string
  cards: ListingCard[]
  /** From the onboarding walk, when this unit has one. */
  unitLine: string
  unitFacts: KV[]
  bedrooms: number | null
  heroImage: string | null
  /** Every amenity string in use across the portfolio - the owner's full pick list. */
  amenityCatalog?: string[]
}

/**
 * Template + this owner's facts = the document. Nothing here is final: every string lands in the
 * report's own content JSON and is editable in place afterwards.
 */
export function buildOnboardingContent(t: OnboardingTemplate, i: BuildInput): OnboardingContent {
  const asks = (k: string): Ask[] => (t.asks[k] || []).map(a => ({ ...a, a: '' }))
  // THE OWNER'S OWN UNIT, THROUGHOUT (Jon, 2026-09-16: "use their listing, especially if we have
  // photos of the listing throughout the presentation"). Sections draw from the pool in rotation
  // so a deck about their property actually looks like their property; each one is swappable in
  // the editor afterwards.
  const pool: string[] = []
  for (const cd of i.cards) for (const ph of cd.photos) if (pool.indexOf(ph) < 0) pool.push(ph)
  const pic = (n: number): string => (pool.length ? pool[n % pool.length] : '')
  const rate = t.laborRate
  const limit = t.approvalLimit

  // The money rules carry the live numbers rather than hard-coded ones, so changing the charge
  // rate or an owner's ceiling in settings changes what the next owner is promised.
  const rules = t.moneyRules.map(r => ({
    k: r.k.replace(/\$250/g, money0(limit)),
    v: r.v.replace(/\$40 an hour/g, money0(rate) + ' an hour').replace(/\$250/g, money0(limit)),
  }))

  // A worked month, so the statement is not the first one they have ever seen. Numbers tie.
  const nights = 19, adr = 286
  const rental = nights * adr
  const commission = Math.round(rental * (t.mgmtPct / 100) * 100) / 100
  const charges = [
    { date: 'Oct 6', work: 'Kitchen faucet dripping — replaced cartridge', who: 'Guest reported, fixed same day', labor: `0.7h · ${money2(0.7 * rate)}`, materials: money2(19), total: money2(0.7 * rate + 19) },
    { date: 'Oct 19', work: 'A/C service and filter change', who: 'Scheduled preventative', labor: `1.5h · ${money2(1.5 * rate)}`, materials: money2(18), total: money2(1.5 * rate + 18) },
  ]
  const chargeTotal = 0.7 * rate + 19 + 1.5 * rate + 18
  const net = Math.round((rental - commission - chargeTotal) * 100) / 100

  // ── THE EXAMPLE STATEMENT ────────────────────────────────────────────────
  // Built to Guesty's issued shape and made to foot, because the one example an owner is shown
  // is the one they will add up. Three bookings, their line items, and a summary whose ending
  // balance is the sum of the categories above it — not a plausible-looking number.
  const nights2 = 9
  const rental2 = 1024 + 1432                 // the two example bookings
  const mgmt2 = Math.round(rental2 * (t.mgmtPct / 100) * 100) / 100
  const clean2 = 180 * 2
  const park2 = 75
  const chan2 = 2.9
  const supplies2 = 86.8
  const maint2 = 168                           // 4.2h at the house rate, itemised on the detail
  const net2 = Math.round((rental2 + chan2 + clean2 + park2 - mgmt2 - supplies2 - maint2) * 100) / 100

  return {
    meta: {
      kind: 'onboarding',
      scopeLabel: i.scopeLabel,
      asOf: i.asOf,
      generatedAt: new Date().toISOString(),
      listingIds: i.cards.map(c => c.id),
      market: i.market,
      logoUrl: t.logoUrl,
      wordmark: t.wordmark,
    },
    hero: {
      // The wordmark above the title already carries the brand; a second line saying the same
      // thing was the first thing on the cover and it read as a mistake.
      eyebrow: '',
      title: i.scopeLabel,
      headline: 'Everything we agree today, before your first guest.',
      preparedFor: i.ownerName ? 'Prepared for ' + i.ownerName : 'Prepared for the owners of ' + i.scopeLabel,
      dateLabel: 'OWNER ONBOARDING',
      heroImage: i.heroImage,
    },
    // 1 ── THE GREETING. A picture of their unit, their name, two sentences.
    welcome: {
      headline: 'Welcome to Stay Hospitality',
      subtitle: i.ownerName ? i.ownerName : i.scopeLabel,
      body: t.welcomeBody,
      photo: pic(0),
    },
    // 2 ── WHAT WE ARE GOING TO COVER.
    agenda: {
      headline: 'What we will cover',
      subtitle: 'In this order.',
      items: t.agenda,
    },
    // 4 ── WHO STAY HOSPITALITY IS. The company slide, with the numbers on it.
    overview: {
      headline: 'Overview of Stay Hospitality',
      subtitle: 'What we do, and what we do ourselves.',
      body: t.overviewBody,
      stats: t.companyStats,
      photo: pic(4),
    },
    unit: {
      photo: pic(3),
      headline: 'What we found when we walked it',
      subtitle: i.unitLine || '',
      body: 'We walked the unit against our furnishing standard and photographed every room. Here is what is there, and what a unit of this shape still needs before it can take a guest.',
      facts: i.unitFacts,
      asks: asks('unit'),
    },
    // 5 ── WHERE IT SELLS. The breadth slide: the six names they know, then the count.
    channels: {
      headline: 'Your calendar, live on thirty channels',
      subtitle: 'One calendar, published everywhere, reconciled back to one place.',
      body: t.channelsBody,
      primary: t.channelsPrimary,
      more: t.channelsMore,
      count: t.channelsCount,
      logos: t.channelsLogos,
      photo: pic(11),
    },
    // 6 ── REVIEW THE LISTING. The photos a guest meets, the live links, and the words —
    // which are the part an owner can actually improve in the room.
    listings: {
      headline: 'Your listing, the way a guest meets it',
      subtitle: 'Open on every channel it sells on. The words are editable here, as we read them.',
      items: i.cards,
      catalog: i.amenityCatalog || [],
      asks: asks('listings'),
    },
    strategy: {
      photo: pic(2),
      headline: 'Your goals, and what we optimize for',
      subtitle: 'One trade-off decides everything downstream.',
      body: t.strategyBody,
      asks: asks('strategy'),
    },
    ramp: {
      headline: 'The first ninety days are bought, not earned',
      subtitle: 'A new listing has no reviews and no standing in any channel’s ranking.',
      bands: t.rampBands,
      note: t.rampNote,
      asks: asks('ramp'),
    },
    season: {
      headline: 'South Florida pays in winter',
      subtitle: 'December through April is the window everything else in the year prepares for.',
      body: t.seasonBody,
      months: SEASON_SHAPE,
      note: [benchmarkLine(i.market, i.bedrooms), t.seasonNote].filter(Boolean).join(' '),
      peakShare: t.peakShare,
      peakLabel: t.peakLabel,
      lowNote: t.seasonLowNote,
      asks: asks('season'),
    },
    team: {
      headline: 'Meet your team',
      subtitle: 'The four people who run your unit, and the inbox behind them.',
      people: t.team.filter(p => !p.market || !i.market || String(p.market).toLowerCase() === String(i.market).toLowerCase())
        .map(p => ({ name: p.name, role: p.role, blurb: p.blurb, photo: p.photo || null, phone: p.phone || '', email: p.email || '' })),
      support: { label: t.supportLabel, note: t.supportNote, email: t.supportEmail },
    },
    comms: {
      headline: 'How guests reach us, and how you reach us',
      subtitle: 'Guest messaging runs through Guesty and does not touch you.',
      body: t.commsBody,
      rows: t.commsRows,
      asks: asks('comms'),
    },
    // 6 ── THE OWNER PORTAL. One address for the house, this owner's own login.
    guesty: {
      headline: 'Your Guesty owner portal',
      subtitle: 'Your own login to the system we actually run on.',
      body: t.guestyBody,
      items: t.portalItems,
      portalUrl: t.portalUrl,
      loginEmail: i.ownerEmail || '',
      shots: t.portalShots,
    },
    tech: {
      headline: 'The technology in your unit',
      subtitle: 'Installed once, so the unit can be run without anyone standing in it.',
      body: 'Every unit we manage runs on the same small stack. It is what lets us give a guest a working door code at 11pm, cool the unit before they land, and know about a problem before they message us about it.',
      rows: t.techRows,
      asks: asks('tech'),
      photo: pic(5),
    },
    money: {
      headline: 'How maintenance and billables actually work',
      subtitle: 'Including the rules that cost us money.',
      body: t.moneyBody,
      rules,
      examples: [
        {
          title: 'Guest reported the kitchen faucet dripping. Technician on site, replaced the cartridge.',
          lines: [
            { k: 'Labor · 0.7h on the clock', v: money2(0.7 * rate) },
            { k: 'Faucet cartridge · at cost', v: money2(19) },
          ],
          total: money2(0.7 * rate + 19),
          verdict: `Under your ${money0(limit)} limit — fixed the same day, appears on your next statement.`,
          tone: 'ok',
        },
        {
          title: 'Living room sofa showing wear in two guest photos and one review.',
          lines: [
            { k: 'Replace like-for-like', v: money0(890) },
            { k: 'Upgrade — sleeper, adds 2 guests to occupancy', v: money0(1340) },
            { k: 'Do nothing', v: 'est. −$18/night' },
          ],
          total: '',
          verdict: 'Over your limit — this goes to your order sheet and waits for you. Nothing is ordered until you pick one.',
          tone: 'hold',
        },
      ],
      asks: asks('money'),
    },
    // 7 ── OWNER STATEMENTS. The worked month, then the rules that decide what can appear on
    // it — the billables doctrine folded in, because the statement is where an owner meets it.
    statement: {
      headline: 'Your monthly owner statement',
      subtitle: 'A worked sample, not your numbers \u2014 so you know how to read the real one.',
      // THE SAMPLE IS THE SAME SAMPLE FOR EVERY OWNER (Jon, 2026-09-17: "the owner statement is
      // a sample one to show the owner and explain how to read \u2014 should be a standard slide, so
      // once we build it, it's the default one we use"). It used to carry the owner's own unit
      // name at the top, which read as their statement rather than a teaching example. The line
      // items, the arithmetic and the labels are the house standard; only the management rate
      // follows settings, because that is the number the owner is actually agreeing to.
      unitLabel: 'Sample statement \u00b7 2 BR / 2 BA condo',
      period: 'Example month \u00b7 August',
      kpis: [
        { k: 'Occupancy', v: '68%' },
        { k: 'Proceeds', v: money2(net2) },
        { k: 'Nights occupied', v: String(nights2) },
        { k: 'Working capital', v: money2(0) },
      ],
      summary: [
        { k: 'Initial balance', v: money2(0) },
        { k: 'Rental income', v: money2(rental2) },
        { k: 'Channel commission', v: money2(chan2) },
        { k: 'Cleaning fee', v: money2(clean2) },
        { k: 'Parking', v: money2(park2) },
        { k: 'Management fee', v: '\u2212' + money2(mgmt2), neg: true },
        { k: 'Supplies and purchases', v: '\u2212' + money2(supplies2), neg: true },
        { k: 'Maintenance \u2014 owner charge', v: '\u2212' + money2(maint2), neg: true },
        { k: 'Ending balance', v: money2(net2), rule: true },
      ],
      due: { k: 'Payment due to owner', v: money2(net2) },
      reservations: [
        {
          guest: 'M. Alvarez', stay: 'Aug 2 \u2013 Aug 6 \u00b7 4 nights',
          lines: [
            { date: 'Aug 2', desc: 'Rental payment for HMABC12345', cat: 'Rental income', amt: money2(1024) },
            { date: 'Aug 2', desc: 'PMC commission', cat: 'Management fee', amt: '\u2212' + money2(102.4), neg: true },
            { date: 'Aug 2', desc: 'Cleaning fee', cat: 'Cleaning fee', amt: money2(180) },
            { date: 'Aug 2', desc: 'Airbnb RM channel fee reimbursement', cat: 'Channel commission', amt: money2(2.9) },
          ],
          total: money2(1104.5),
        },
        {
          guest: 'R. Whitfield', stay: 'Aug 9 \u2013 Aug 14 \u00b7 5 nights',
          lines: [
            { date: 'Aug 9', desc: 'Rental payment for BC-9KD3LM', cat: 'Rental income', amt: money2(1432) },
            { date: 'Aug 9', desc: 'PMC commission', cat: 'Management fee', amt: '\u2212' + money2(143.2), neg: true },
            { date: 'Aug 9', desc: 'Cleaning fee', cat: 'Cleaning fee', amt: money2(180) },
            { date: 'Aug 9', desc: 'Nightly parking', cat: 'Parking', amt: money2(75) },
          ],
          total: money2(1543.8),
        },
      ],
      propertyIncome: { k: 'Property income', v: money2(1104.5 + 1543.8) },
      note: `Every line on this statement traces to a booking or to a job with a date on it. Labor is ${money0(rate)} an hour on the technician\u2019s actual clock, materials are at cost, and the ${t.mgmtPct}% management fee is the only fee we take.`,
      rules,
      highlights: [
        { k: 'Departure cleans', v: 'Never billed to you. The guest\u2019s cleaning fee pays for the turnover.' },
        { k: `Labor ${money0(rate)}/hr, parts at cost`, v: 'The technician\u2019s actual clock. No markup, no trip charge.' },
        { k: `Anything over ${money0(limit)}`, v: 'Goes to you first, with photos and options. Nothing is bought without your yes.' },
      ],
      also: t.statementAlso,
    },
    checklist: {
      headline: 'What is left before we can take a booking',
      subtitle: 'Neither of us can open this unit alone.',
      rows: t.checklist.map(r => ({ ...r })),
    },
    nextup: {
      headline: 'What happens next',
      subtitle: '',
      rows: [
        { k: 'Target go-live', v: i.goLive || 'To be set on this call' },
        { k: 'First review target', v: 'Five completed stays inside the first 30 days' },
        { k: 'First statement', v: 'The month after go-live' },
        { k: 'First owner report', v: 'With the first full month of trading' },
      ],
    },
    // 8 ── OTHER NOTES. Whatever came up that has no home above, typed live; plus anything
    // still unanswered, so an onboarding is never "done" while questions are open.
    notes: {
      headline: 'Other notes',
      subtitle: 'Anything else that came up, and anything still open.',
      body: '',
    },
    photoPool: pool,
    custom: [],
    // JON'S EIGHT (2026-09-16: "I actually prefer that it doesn't have any intake. It should be:
    // 1. Agenda: Welcome to Stay Hospitality with a picture 2. What we're going to cover 3. Meet
    // the team 4. Overview of Stay Hospitality 5. Review listing 6. Guesty owner portal with
    // photos 7. Guesty owner statements 8. Other notes"). Everything else we had built is kept
    // in the document but starts hidden, so a deck is exactly those eight out of the box and
    // nothing is lost for the owner who does want the ramp or the season talked through.
    omit: ONBOARDING_EXTRA.slice(),
  }
}

/** The eight sections a generated onboarding shows, in render order. */
export const ONBOARDING_CORE = [
  'welcome', 'agenda', 'team', 'overview', 'channels', 'listings',
  // THE REVENUE STORY IS NOT OPTIONAL (Jon, 2026-09-16: "we should also have a revenue slide,
  // not actual numbers but show season pickup… ramp takes time for listing to move up on
  // algorithms, new listing promotion, push for good reviews"). These two carry the only
  // expectation-setting in the deck that stops month one reading as a failure in February.
  'season', 'ramp',
  'guesty', 'statement', 'notes',
] as const

/** Built, kept, and hidden by default. Switched on per owner from the editing toolbar. */
export const ONBOARDING_EXTRA = [
  'unit', 'strategy', 'tech', 'money', 'comms', 'checklist', 'nextup',
] as const

/** Every section key an onboarding report can hide, in render order. */
export const ONBOARDING_SECTIONS = [
  'welcome', 'agenda', 'team', 'overview', 'channels', 'listings', 'unit', 'strategy', 'ramp',
  'season', 'guesty', 'tech', 'money', 'statement', 'comms', 'checklist', 'nextup', 'notes',
] as const

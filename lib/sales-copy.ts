// THE SALES DECK — the house words (Jon, 2026-10-27: "build a sales deck for Nick... should
// highlight all the key tech we use, how Lighthouse works, onboarding, etc... show the team, have
// a place for Nick to add his face, walk through onboarding, connecting to HostGPO... how
// operations works... talk about AI website optimization to drive direct bookings... talk
// marketing, talk distribution, talk operations").
//
// IT IS THE ONBOARDING DECK'S YOUNGER SIBLING, ON PURPOSE. The onboarding presentation is run
// AFTER an owner signs: it walks their own listing, agrees the strategy and collects answers. The
// sales deck is run BEFORE, and the difference is who is being asked to decide. So it borrows the
// pitch slides wholesale from lib/onboarding-copy — the company, the properties, the process, the
// guest experience, revenue and Pacer, the ramp, the stack — rather than writing a second set
// that would drift from the first within a month. Everything in THIS file is the half the
// onboarding deck does not have: the person presenting it, how the operation actually runs,
// marketing and distribution, direct bookings, a tour of Lighthouse, what onboarding looks like
// from the owner's side, HostGPO, their market, and the close.
//
// THE RULE THE PITCH COPY SET, KEPT HERE: every claim is one the person across the table can
// check. Where we do not have a figure we can stand behind, the slide makes an argument instead
// of quoting a number. Borrowed statistics are attributed to whoever earned them, in the sentence
// that uses them, or they stay out.
import type { KV } from './onboarding-report'

// ── 1 · WHO IS PRESENTING ───────────────────────────────────────────────────
// Jon: "have a place for Nick to add his face". A deck handed to a prospect by a named person
// closes better than one from a company, so the second slide is the person, not the pitch. The
// defaults are empty rather than invented: a placeholder name that reaches a prospect is worse
// than a blank the presenter fills in once and reuses on every deck after.
export const CONTACT_HEADLINE = 'Your point of contact'
export const CONTACT_SUBTITLE = 'One person who owns this relationship, start to finish.'
export const CONTACT_BODY =
  'You will not be handed to a queue. The person who walks you through this deck is the person who answers when you call, brings the right people in when something needs them, and stays with your account after it goes live.'
export type ContactCard = { name: string; role: string; phone: string; email: string; photo: string; blurb: string }
// EMPTY, NOT PLACEHOLDER PROSE. Instructional copy stored as content is copy that eventually
// reaches a prospect. The slide shows the hints as placeholders in edit mode instead, and prints
// only the lines that have been filled in.
export const CONTACT_DEFAULT: ContactCard = {
  name: '', role: 'Business Development', phone: '', email: '', photo: '', blurb: '',
}

// ── 2 · HOW OPERATIONS WORKS ────────────────────────────────────────────────
// Jon: "how operations works". The single question every serious owner asks and almost no deck
// answers concretely: who physically shows up, when, and how do you know they did. Written as the
// shape of a day, because a day is checkable and an org chart is not.
export const OPS_HEADLINE = 'How operations works'
export const OPS_SUBTITLE = 'Our own people, on our own payroll, running the same day every day.'
export const OPS_BODY =
  'Housekeeping, maintenance, inspections and guest care are in-house. Nobody is dispatched from an app and hoped for. Every market has its own crew, its own supervisor and its own escalation path, and every job carries a checklist, an assignee, a timestamp and photographs.'
export const OPS_ROWS: KV[] = [
  { k: 'The day starts the night before', v: 'Tomorrow\'s departures, arrivals and same-day turns are built into a schedule the whole team can see, with the cleans assigned by name before anyone goes to bed.' },
  { k: 'The turn', v: 'Departure clean against the standard checklist, photographed as it runs. A same-day turn is flagged as one, because an arrival at 4pm behind an 11am checkout is a different job from a vacant week.' },
  { k: 'The inspection', v: 'A supervisor stands in the unit before the guest does. Lights, water, AC, wifi, supplies and presentation against a fixed list — not a glance from the doorway.' },
  { k: 'Maintenance', v: 'Anything found becomes a tracked job with an owner and a deadline, routed to the right trade. Preventative work runs on a routine per unit, not when something finally breaks.' },
  { k: 'Guest care', v: 'Messages answered around the clock from one inbox across every channel. A guest who cannot get in is an emergency on our side of the line, not theirs.' },
  { k: 'Escalation', v: 'Housekeeping, maintenance, guest care and management sit in one room in real time, in two languages. A problem at your property reaches whoever can fix it in seconds.' },
]
export const OPS_NOTE =
  'All of it is recorded as it happens, so readiness is documented rather than assumed — and so the answer to "what happened at my property last Tuesday" is a record, not a recollection.'

// ── 3 · MARKETING ───────────────────────────────────────────────────────────
// Jon: "talk marketing". Distinct from distribution below: distribution is WHERE the calendar is
// published, marketing is what we do to make someone choose it once they see it.
export const MARKETING_HEADLINE = 'Marketing'
export const MARKETING_SUBTITLE = 'Getting chosen, not just getting seen.'
export const MARKETING_BODY =
  'Visibility puts your property in front of a guest. Marketing is everything that happens in the ten seconds after, while they decide between you and three others in the same building.'
export const MARKETING_ROWS: KV[] = [
  { k: 'Photography and the first three frames', v: 'The images a guest sees before deciding, ordered by us and re-ordered as we learn what converts. The hero shot is a decision, not whatever the camera took first.' },
  { k: 'Copy written for the choice', v: 'Titles and descriptions written for the guest comparing options right now: specific about the space, honest about the trade-offs, and tuned to the words people actually search.' },
  { k: 'Channel promotions', v: 'New-listing boosts, early-bird and last-minute offers, seasonal pushes and member rates used deliberately on the dates that need them, not switched on and forgotten.' },
  { k: 'Social and content', v: 'The property and the neighbourhood shown the way a guest would experience them, feeding the channels and the direct site.' },
  { k: 'The guidebook', v: 'A digital guidebook for every unit — arrival, building rules, local tips, emergencies — which earns the review as much as it serves the guest.' },
  { k: 'Email to past guests', v: 'Every stay builds a guest profile. Campaigns bring the right ones back for the right dates, at no channel commission.' },
]

// ── 4 · DISTRIBUTION ────────────────────────────────────────────────────────
// Jon: "talk distribution". The channels slide in the onboarding deck is a WALL OF NAMES, which
// does the recognition job. This one explains the mechanism, because an owner who has only ever
// been on one site does not know what a connected calendar buys them.
export const DIST_HEADLINE = 'Distribution'
export const DIST_SUBTITLE = 'One calendar, 40+ places to sell it.'
export const DIST_BODY =
  'A property on one channel sells at the speed of one audience. Yours is published across every major channel and a long tail of partners from a single calendar, so a booking can arrive from wherever it arrives and two guests can never book the same night.'
export const DIST_ROWS: KV[] = [
  { k: 'One calendar, every channel', v: 'Rates, availability and minimum stays pushed out and bookings pulled back in real time. No double bookings, no manual blocking, no channel quietly out of date.' },
  { k: 'The channels you know', v: 'Airbnb, Vrbo, Booking.com, Expedia and their partner networks, plus corporate and extended-stay demand that never touches a consumer site.' },
  { k: 'The long tail', v: 'Dozens of smaller and regional partners that cost nothing to be on and reach audiences the big four do not.' },
  { k: 'Direct', v: 'Our own booking site and the guidebook link, where a repeat guest books without a channel taking a cut.' },
  { k: 'Channel mix by date', v: 'Where a slow window gets pushed harder, and which channels carry which dates. A soft March is worked in December.' },
  { k: 'One set of rules', v: 'House rules, cancellation terms, fees and guest screening applied consistently everywhere, so the property is sold the same way on every site.' },
]

// ── 5 · AI WEBSITE OPTIMIZATION AND DIRECT BOOKINGS ─────────────────────────
// Jon: "talk about AI website optimization to drive direct bookings".
//
// DELIBERATELY NO PERCENTAGE HERE. The honest pitch is the mechanism and the arithmetic of a
// commission not paid; a direct-booking share quoted as a promise is the sentence an owner
// repeats back to us in month four. Put our own figure in the editor when we can stand behind it.
export const DIRECT_HEADLINE = 'Direct bookings'
export const DIRECT_SUBTITLE = 'Every channel booking costs a commission. A direct one does not.'
export const DIRECT_BODY =
  'Channels are how a guest finds you the first time. They should not be how the same guest finds you the third time. Our own site, written and tuned with AI and fed by the guest profiles every stay builds, is how a share of your nights arrive without a channel in the middle.'
export const DIRECT_ROWS: KV[] = [
  { k: 'Pages written for search', v: 'Property and neighbourhood pages generated and kept current for the terms guests actually search — the building, the area, the season — so the site ranks for the searches a channel listing cannot.' },
  { k: 'Tuned on what converts', v: 'Titles, descriptions and photo order measured against what guests stop on and praise, then rewritten. The same optimization runs on the channel listings.' },
  { k: 'Guest profiles', v: 'Every stay records who came, what they valued and how often they have booked. That is the list the campaigns go to.' },
  { k: 'Campaigns that bring them back', v: 'Past guests invited back for the dates that need filling, with an offer that still nets more than the channel would have left you.' },
  { k: 'The guidebook as a front door', v: 'The digital guidebook every guest uses during their stay carries the direct booking link for the next one.' },
  { k: 'The arithmetic', v: 'A direct booking keeps the commission a channel would have taken. On a repeat guest, that is margin with no acquisition cost behind it.' },
]
export const DIRECT_NOTE =
  'Channel distribution is not reduced to make room for this. Direct is added on top, on the nights that would otherwise have gone cheap or empty.'

// ── 6 · A TOUR OF LIGHTHOUSE ────────────────────────────────────────────────
// Jon: "how Lighthouse works". The stack slide names it in one line. This one shows it, because
// software built in-house is the single thing on the table a competitor cannot buy, and a list of
// adjectives does not prove it exists. Each row is a screen that can be opened in the room.
export const LH_HEADLINE = 'Lighthouse'
export const LH_SUBTITLE = 'Our own software. Built for this business, by this business.'
export const LH_BODY =
  'Most managers run on the same three or four bought platforms as everyone else, and live with the gaps between them. We built the layer that closes those gaps — and it is the reason the answer to a question about your property is a screen rather than a phone call to somebody who might remember.'
export const LH_ROWS: KV[] = [
  { k: 'The day board', v: 'Every arrival, departure, clean, inspection and open job across the portfolio on one screen, live. Who is doing it, where it stands, what is at risk.' },
  { k: 'The schedule', v: 'Cleans and field work assigned by name, moved by hand when a booking changes, pushed straight to the crew with the brief they need for that unit.' },
  { k: 'Issues and guest feedback', v: 'Anything a guest says, a cleaner finds or a call surfaces becomes a tracked job on the right unit, with photos, an owner and a deadline.' },
  { k: 'Guest inbox and calls', v: 'Messages from every channel in one place, and recorded calls turned into notes and next steps on the booking instead of staying in somebody\'s head.' },
  { k: 'Listing optimization', v: 'Every listing scored against what guests search and praise, with the specific fix named — the missing amenity, the weak title, the photo in the wrong place.' },
  { k: 'Reviews', v: 'Replies drafted and tracked on every channel, and the themes behind them turned into work on the unit.' },
]
// SIX ROWS, BECAUSE SEVEN SCROLLED. Owner reporting moved into the note rather than being cut:
// on a slide that is presented at 16:9, a row you have to scroll to is a row nobody reads.
export const LH_NOTE =
  'The report you receive is generated from this same data, so nothing is retyped on the way to you. And none of it is yours to learn or log into — it exists so the people running your property are never working from memory.'

// ── 7 · ONBOARDING, FROM THE OWNER'S SIDE ───────────────────────────────────
// Jon: "walk through onboarding". The internal checklist already exists in the onboarding deck
// (who does what, by when). A prospect does not want our checklist, they want to know what the
// next four weeks cost THEM in time and decisions.
export const ONB_HEADLINE = 'Onboarding'
export const ONB_SUBTITLE = 'From signature to first booking, usually inside four weeks.'
export const ONB_BODY =
  'Most of it is on us. What we need from you is the paperwork, the keys and about two hours of decisions.'
export type Step = { k: string; v: string; who: string; when: string }
export const ONB_STEPS: Step[] = [
  { k: 'Agreement and account', v: 'Management agreement signed, your owner profile and payout details set up, insurance and building requirements confirmed.', who: 'Us, with you', when: 'Week 1' },
  { k: 'The walk-through', v: 'We walk the property and record it: condition, contents, what is missing, what needs work before a guest sees it.', who: 'Us', when: 'Week 1' },
  { k: 'Furnishing and supplies', v: 'Anything needed is specified and ordered — furniture, linen, kitchen, consumables — through our partner accounts, including HostGPO member pricing.', who: 'Us, you approve', when: 'Weeks 1–2' },
  { k: 'Photography and the listing', v: 'Professional photography, then the listing built from scratch: title, description, amenities audited against every channel\'s filters.', who: 'Us', when: 'Week 2' },
  { k: 'Published everywhere', v: 'The calendar goes live across every channel at once, into the new-listing promotion window each channel grants exactly once.', who: 'Us', when: 'Week 3' },
  { k: 'Pricing set', v: 'Your revenue manager builds the rate strategy: opening rate, minimum stays, seasonality and the first ninety days of the calendar.', who: 'Us', when: 'Week 3' },
  { k: 'Operations live', v: 'Access, door codes, parking, building rules and the cleaning standard loaded, and the property enters the daily schedule.', who: 'Us', when: 'Week 3' },
  { k: 'The kickoff call', v: 'We walk your finished listing with you channel by channel, agree the strategy, and answer everything. You get that session as a document.', who: 'Us, with you', when: 'Week 4' },
]
export const ONB_NOTE =
  'Your part is the agreement, access, and approving what gets bought. Everything else is work we do and show you.'

// ── 8 · HOSTGPO ─────────────────────────────────────────────────────────────
// Jon, 2026-10-27: "it's just an additional partner that we have to get access to great brands and
// discounts on furniture, furnishings, rugs, beds, etc., just with the onboarding profile."
//
// Scoped exactly to that. No savings percentage is printed, because the rates are the partner's
// and vary by brand, and a number on this slide is the one a prospect will hold us to.
export const GPO_HEADLINE = 'Furnishing, at our pricing'
export const GPO_SUBTITLE = 'Our HostGPO membership comes with the onboarding profile.'
export const GPO_BODY =
  'Furnishing a short-term rental well is the biggest cheque an owner writes before the first guest arrives. Through our HostGPO group-purchasing membership, that cheque is written at member pricing across a catalogue of brands, and you do not need an account, a minimum order or a membership of your own to use it.'
export const GPO_ROWS: KV[] = [
  { k: 'The brands', v: 'Furniture, mattresses and beds, rugs, linen, appliances, kitchen and outdoor — recognised brands through group-purchasing agreements rather than whatever is in stock locally.' },
  { k: 'Member pricing', v: 'Our membership rate on the catalogue, with the terms the group negotiated rather than the retail price in front of a single buyer.' },
  { k: 'Specified for rental use', v: 'Chosen for what survives turnover and photographs well, not for a showroom. A mattress in a rental is a different purchase from a mattress at home.' },
  { k: 'Ordered and tracked', v: 'Every item specified, approved by you, ordered, received and installed on a tracked list, so nothing arrives late or goes missing between the order and the unit.' },
  { k: 'Restocking too', v: 'Consumables and replacements run through the same accounts for the life of the agreement, not just at setup.' },
]
export const GPO_NOTE =
  'It comes with the onboarding profile. There is nothing extra to sign and nothing extra to pay for access.'

// ── 9 · THE MARKET ──────────────────────────────────────────────────────────
// Jon, 2026-10-27: "customization features: talking about the property, the market, the area, etc."
// Three empty fields the presenter fills for the property in front of them. Prompts rather than
// prose, because a generic paragraph about South Florida is worse than a blank one: a prospect
// reading boilerplate about their own neighbourhood stops believing the rest of the deck.
export const MARKET_HEADLINE = 'Your property, your market'
export const MARKET_SUBTITLE = 'What we already know about this building and this stretch of the market.'
export const MARKET_PROMPTS: KV[] = [
  { k: 'The property', v: '' },
  { k: 'The market', v: '' },
  { k: 'The area', v: '' },
  { k: 'What we would do first', v: '' },
]
export const MARKET_HINTS: Record<string, string> = {
  'The property': 'What this unit is, what it has, and what a guest is buying when they book it.',
  'The market': 'Who is booking in this building and at what rate — comp set, season, the demand you are competing for.',
  'The area': 'Why a guest chooses this neighbourhood: what is walkable, what is on, what fills the calendar.',
  'What we would do first': 'The first three things we would change about how this property is sold.',
}

// ── 10 · THE CLOSE ──────────────────────────────────────────────────────────
export const CLOSE_HEADLINE = 'What happens next'
export const CLOSE_SUBTITLE = ''
export const CLOSE_ROWS: KV[] = [
  { k: 'A revenue projection for this property', v: 'Built on what comparable units in this market actually earned, not a percentage of a hope. We will send it in writing.' },
  { k: 'A walk of the property', v: 'An hour on site tells us what the listing needs and what the setup will cost. No charge and no commitment.' },
  { k: 'The agreement', v: 'One document, plain terms, no lock-in beyond the notice period. We will walk you through every clause before you sign anything.' },
  { k: 'Four weeks later', v: 'Live on every channel, priced daily, with a team that knows your building.' },
]
export const CLOSE_NOTE = 'Questions are welcome at any point, including the uncomfortable ones.'

// ── 11 · THE VIDEO SLIDE ────────────────────────────────────────────────────
// Jon, 2026-10-27: "what I think I'd do is build a video that we can embed into one of the slides."
// The slot ships empty and takes a YouTube, Vimeo or direct file URL. A deck with no URL simply
// does not carry the slide, so an unfinished video never shows a prospect a grey box.
export const VIDEO_HEADLINE = 'See it in two minutes'
export const VIDEO_SUBTITLE = ''
export const VIDEO_BODY = ''

/** The order the sales deck runs in. The renderer walks this, so reordering here reorders the deck. */
export const SALES_AGENDA: KV[] = [
  { k: 'Who we are', v: 'The company, the markets, and what we already run' },
  { k: 'How operations works', v: 'Our own people, the day, and the record behind it' },
  { k: 'Marketing and distribution', v: 'Where your property sells, and why a guest chooses it' },
  { k: 'Revenue management', v: 'A named revenue manager pricing your calendar every day' },
  { k: 'The technology', v: 'The platforms we run on, and the software we built ourselves' },
  { k: 'Direct bookings', v: 'The nights that arrive without a channel commission' },
  { k: 'Onboarding', v: 'Signature to first booking, and what we need from you' },
  { k: 'What happens next', v: 'A projection, a walk-through, and a plain agreement' },
]

// ── 12 · THE SHORT DECK (Jon, 2026-10-27: "visually it's way too long, need to make it shorter,
// stronger sales, to get them to want to learn more — think initial conversation, send this deck
// to get them interested. Should have a place to share projections, about us, how we operate and
// how we get max revenue. We can add our management terms. Needs to be customizable fully.")
//
// SAME DOCUMENT, TWO LENGTHS. The short deck is not a different deck: it is this one with most of
// the slides switched off, because the full walkthrough is still the right thing to carry into a
// sit-down and maintaining two of them would mean fixing every sentence twice. Switching between
// them in the editor only moves keys in and out of `omit`, so a slide someone edited is still
// there, with the edit, when the long version comes back on.
//
// WHAT SURVIVES THE CUT is what a stranger needs to want a second conversation: who we are, the
// buildings we run, how the operation works, how the money gets made, what their property could
// do, the terms, and how to say yes. Everything that explains rather than argues waits for the
// meeting.
export const SHORT_KEEP = [
  'welcome', 'contact', 'overview', 'experience', 'ops', 'maxrev', 'proof', 'plan', 'terms', 'onbsteps', 'close',
]
/** Every slide the sales deck can carry, so the short/full switch has something to subtract from. */
export const SALES_KEYS = [
  'welcome', 'contact', 'market', 'agenda', 'team', 'overview', 'experience', 'ops', 'craft',
  'marketing', 'dist', 'channels', 'direct', 'guestcare', 'revenue', 'stack', 'lighthouse',
  'maxrev', 'proof', 'plan', 'terms', 'onbsteps', 'gpo', 'guesty', 'statement', 'ai',
  'season', 'ramp', 'rampsteps', 'money', 'video', 'close',
]
/** The short deck is the full one with everything that explains rather than argues switched off.
 *  It lives in THIS file, not in lib/sales-deck, because the deck renderer is a client component
 *  and sales-deck reaches the server-only onboarding builder. */
export const shortOmit = (): string[] => SALES_KEYS.filter(k => SHORT_KEEP.indexOf(k) < 0)

// ── 13 · HOW WE GET MAX REVENUE ─────────────────────────────────────────────
// The short deck's one revenue slide. The full deck argues this across five — pricing, the comp
// set, distribution, the listing craft, direct — and each of those is a better slide than this
// one. This is the version for someone who has given us ninety seconds.
export const MAXREV_HEADLINE = 'How we get you the most revenue'
export const MAXREV_SUBTITLE = 'Five levers, worked every day.'
export const MAXREV_BODY =
  'Revenue is not one decision at the start. It is a rate moved daily against live demand, on a listing built to convert, sold in every place a guest might look.'
export const MAXREV_ROWS: KV[] = [
  { k: 'Priced every day', v: 'A named revenue manager at Pacer, our revenue partner, works your rate daily against live demand, your comp set and the dates ahead. Not a rule set once and left.' },
  { k: 'Sold in 40+ places', v: 'One calendar published across every major channel and a long tail of partners, so a booking can arrive from wherever it arrives.' },
  { k: 'Built to convert', v: 'Photography, title, the first three images and the amenity list set by us. A listing that converts ranks higher, and a higher ranking brings more bookings.' },
  { k: 'The nights others leave empty', v: 'Minimum stays opened and closed by date, gap nights priced to fill, and the big weekends captured months out.' },
  { k: 'Direct, with no commission', v: 'Our own site and the guest profiles every stay builds bring past guests back without a channel taking a cut.' },
]
export const MAXREV_NOTE =
  'You see every decision in your monthly statement and owner report, and any rate can be explained on request.'

// ── 14 · MANAGEMENT TERMS ───────────────────────────────────────────────────
// Jon: "we can add our management terms".
//
// THE NUMBERS WE HOLD ARE PRINTED; THE ONES WE DO NOT ARE PROMPTS. Fee, labour rate and the
// approval ceiling come from the house template, so they are the same figures the onboarding deck
// and the billing rules already use. Contract length, notice and payout timing are not in this
// system, and a term invented on a sales slide is a term we would be held to — so they ship as
// empty rows with a hint, and an unfilled row does not print.
export const TERMS_HEADLINE = 'How we work together'
export const TERMS_SUBTITLE = 'Plain terms, and what each one covers.'
export type TermRow = { k: string; v: string; hint?: string }
export function termRows(mgmtPct: number, laborRate: number, approvalLimit: number): TermRow[] {
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  return [
    { k: 'Management fee', v: mgmtPct + '% of rental revenue', hint: '' },
    { k: 'What it covers', v: 'Guest care around the clock, housekeeping and maintenance coordination, revenue management, distribution across every channel, listing and marketing, and your monthly statement and owner report.' },
    { k: 'Labour', v: 'In-house housekeeping and maintenance at ' + money(laborRate) + ' an hour, billed only for work on your property.' },
    { k: 'Spending', v: 'Anything over ' + money(approvalLimit) + ' comes to you for approval before it is spent. Under it, we fix the problem and it appears on your statement.' },
    { k: 'Your statement', v: '', hint: 'When the statement is issued and when the payout lands' },
    { k: 'Term and notice', v: '', hint: 'Contract length and the notice period either side' },
  ]
}
export const TERMS_NOTE =
  'Nothing here is unusual, and nothing is hidden in an appendix. We will walk you through the agreement clause by clause before you sign it.'

// ── 15 · WHAT PROPERTIES LIKE YOURS EARN ────────────────────────────────────
// Jon, 2026-10-27: "pull actuals from other property owner statements, and pull by owner or by
// listing of actual gross rev and net of fees, but not expense."
//
// REVENUE ONLY, AND THAT IS A RULE RATHER THAN A SETTING. The slide carries gross revenue, revenue
// net of channel fees, occupancy, ADR and nights. It never carries a commission line, a labour
// line or any other expense: those belong to the owner whose property it is, and a prospect is not
// the person to show them to. The endpoint that builds this slide has no access to the expense
// side at all, so the rule cannot be switched off by editing a slide.
//
// AND IT LABELS BY UNIT, NOT BY OWNER. "2BR · 17West" is the comparison a prospect actually wants;
// a name attached to someone else's revenue is a confidence we were not given. The owner's name
// can be switched on per deck when the owner is the point (a developer looking at their own
// portfolio), and it is off until someone does.
export const PROOF_HEADLINE = 'What properties like yours earn'
export const PROOF_SUBTITLE = 'Real bookings, on properties we run today.'
export const PROOF_BODY =
  'Not a model. These are booked and settled numbers from our own portfolio for the window shown, on the same basis your statement would report them.'
export const PROOF_NOTE =
  'Revenue only: gross, and net of the channel fees the booking site keeps. Expenses belong to each owner and are not shown here.'

// ── 16 · THE PROJECTION ─────────────────────────────────────────────────────
// Jon: "make it possible to upload projections and build them into the deck for the property."
export const PLAN_HEADLINE = 'What your property could do'
export const PLAN_SUBTITLE = ''
export const PLAN_BODY =
  'Built from what comparable properties in this market actually earned, not a percentage of a hope. Every assumption behind it is one we will walk through with you.'
export const PLAN_NOTE =
  'A projection is a projection. We will not promise you a number, and we will show you exactly how this one was built.'

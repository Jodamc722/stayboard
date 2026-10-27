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
/** The presenter saved once for the house, in app_settings, and seeded into every new deck. */
export const SALES_CONTACT_KEY = 'sales_contact'
export type SalesContactSetting = ContactCard
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
export const OPS_HEADLINE = 'Run by our own team, on the record'
export const OPS_SUBTITLE = 'Our own people, on our own payroll, running the same day every day.'
export const OPS_BODY =
  'Housekeeping, maintenance, inspections and guest care are in-house. Nobody is dispatched from an app and hoped for. Every market has its own crew, its own supervisor and its own escalation path, and every job carries a checklist, an assignee, a timestamp and photographs.'
export const OPS_ROWS: KV[] = [
  { k: 'The day starts the night before', v: 'Tomorrow\'s departures, arrivals and same-day turns are scheduled and assigned by name before anyone goes to bed.' },
  { k: 'The turn', v: 'Departure clean against the standard checklist, photographed as it runs. A same-day turn is flagged as one.' },
  { k: 'The inspection', v: 'A supervisor stands in the unit before the guest does, against a fixed list. Not a glance from the doorway.' },
  { k: 'Maintenance', v: 'Anything found becomes a tracked job with an owner and a deadline. Preventative work runs on a routine, not when something breaks.' },
  { k: 'Guest care', v: 'Messages answered around the clock from one inbox. A guest who cannot get in is our emergency, not theirs.' },
  { k: 'Escalation', v: 'Housekeeping, maintenance, guest care and management in one room, in two languages. A problem reaches whoever can fix it in seconds.' },
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
  { k: 'One calendar, every channel', v: 'Rates and availability out, bookings back, in real time. No double bookings and no channel quietly out of date.' },
  { k: 'The channels you know', v: 'Airbnb, Vrbo, Booking.com, Expedia and their partner networks — plus corporate and extended-stay demand.' },
  { k: 'The long tail', v: 'Dozens of regional partners that cost nothing to be on and reach audiences the big four do not.' },
  { k: 'Direct', v: 'Our own booking site and the guidebook link, where a repeat guest books without a channel taking a cut.' },
  { k: 'Channel mix by date', v: 'Which channels carry which dates, and where a slow window gets pushed. A soft March is worked in December.' },
  { k: 'One set of rules', v: 'House rules, cancellation terms, fees and screening applied the same way on every site.' },
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
  { k: 'The day board', v: 'Every arrival, departure, clean, inspection and open job on one live screen. Who has it, where it stands, what is at risk.' },
  { k: 'The schedule', v: 'Cleans and field work assigned by name and pushed to the crew with the brief for that unit.' },
  { k: 'Issues and guest feedback', v: 'Anything a guest says or a cleaner finds becomes a tracked job on the right unit, with photos and a deadline.' },
  { k: 'Guest inbox and calls', v: 'Every channel in one inbox, and recorded calls turned into next steps on the booking.' },
  { k: 'Listing optimization', v: 'Every listing scored against what guests search and praise, with the specific fix named.' },
  { k: 'Reviews', v: 'Replies drafted and tracked on every channel, and the themes behind them turned into work.' },
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
export const CLOSE_HEADLINE = 'Three steps to live'
export const CLOSE_SUBTITLE = 'From this conversation to your first booking, usually inside four weeks.'
// THE PROJECTION IS NOT A NEXT STEP ANY MORE (2026-10-27). It used to be the first row here, on a
// deck that now carries the projection three slides earlier — offering a prospect something they
// are already holding reads as a template nobody read. The close asks for the one thing that moves
// the deal: the walk-through.
export const CLOSE_ROWS: KV[] = [
  { k: 'Walk the property', v: 'An hour on site: what the listing needs, what setup will cost, and the projection checked against the real unit. No charge and no commitment.' },
  { k: 'Sign one plain agreement', v: 'Plain terms, no lock-in beyond the notice period, walked through clause by clause before you sign.' },
  { k: 'Go live', v: 'Photographed, listed on every channel, priced daily, with a team that already knows your building.' },
]
export const CLOSE_NOTE = 'The next step is the walk-through. One call books it.'

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
// REVISED 2026-10-27, same day, after Jon read it: "should show tech stack and what it does, how
// we manage properties, listing optimization, distribution, etc." Short no longer means thin. What
// it still means is that nothing on it explains something a prospect did not ask about yet: the
// guest journey, the channel wall, HostGPO, the worked statement, the ramp curve and the money
// rules all wait for the meeting.
// THE PROSPECT'S PROPERTY LEADS (Jon, 2026-10-27: "think like the top sales director in the
// country in short-term rentals... shows their listing, about their area, and market data... sell
// these owners to sign with us. Short, compact, easy to go through, simple, clear, and
// directional").
//
// The onboarding deck runs company-first, which is right for someone who has already signed and is
// now meeting the people who will run their unit. A proposal is the other way round. Nobody reads
// twelve slides about a management company; they read four about their own property and then ask
// who you are. So: their property, their market, what it could earn, what properties like theirs
// do earn — and only then how we get there and who we are.
//
// Thirteen slides and a cover. Every one of them is doing a job the one before it set up.
export const SALES_ORDER = [
  'welcome',
  'property', 'market', 'plan', 'comps', 'edge', 'proof', 'returns',  // theirs: the unit, the area, the money
  'maxrev', 'ops', 'stack',                       // ours: how the money happens
  'overview', 'experience', 'team',               // who is doing it
  'terms', 'onbsteps', 'contact', 'close',        // what it costs and what happens next
  // Everything the full deck adds, in the order it argues best.
  'craft', 'dist', 'marketing', 'channels', 'direct', 'guestcare', 'revenue', 'lighthouse',
  'gpo', 'guesty', 'statement', 'ai', 'season', 'ramp', 'rampsteps', 'money', 'video', 'agenda',
]
// Twelve slides and a cover. The contact card rides on the close rather than taking a slide of
// its own, and the onboarding timeline waits for the meeting: a prospect who has not decided does
// not need the four-week plan yet.
export const SHORT_KEEP = [
  'property', 'market', 'plan', 'comps', 'edge', 'proof', 'returns',
  'maxrev', 'ops', 'stack',
  'overview', 'experience', 'team',
  'terms', 'close',
]
/** Every slide the sales deck can carry, so the short/full switch has something to subtract from. */
export const SALES_KEYS = [
  'welcome', 'contact', 'property', 'market', 'comps', 'edge', 'returns', 'agenda', 'team', 'overview', 'experience', 'ops', 'craft',
  'marketing', 'dist', 'channels', 'direct', 'guestcare', 'revenue', 'stack', 'lighthouse',
  'maxrev', 'proof', 'plan', 'terms', 'onbsteps', 'gpo', 'guesty', 'statement', 'ai',
  'season', 'ramp', 'rampsteps', 'money', 'video', 'close',
]
/** The short deck is the full one with everything that explains rather than argues switched off.
 *  It lives in THIS file, not in lib/sales-deck, because the deck renderer is a client component
 *  and sales-deck reaches the server-only onboarding builder. */
export const shortOmit = (): string[] => SALES_KEYS.filter(k => SHORT_KEEP.indexOf(k) < 0)

// WHAT THE SHORT SWITCH HID IN EVERY EARLIER VERSION OF THIS LIST.
//
// A deck stores the slides it was generated with, so widening SHORT_KEEP would otherwise only
// reach decks made after the change — and the person looking at yesterday's deck, asking for the
// technology slide that is now on the short one, would not get it. The renderer compares what a
// deck hid against what the current list hides and un-hides the difference. Nothing is ever
// hidden by this, so a slide switched off by hand stays off.
//
// Each entry is one shipped version of the list, newest last. Add a line when SHORT_KEEP changes.
export const SHORT_HIDDEN_HISTORY: string[][] = [
  // 2026-10-27, first: kept welcome/contact/overview/experience/ops/maxrev/proof/plan/terms/onbsteps/close
  ['market', 'agenda', 'team', 'craft', 'marketing', 'dist', 'channels', 'direct', 'guestcare',
    'revenue', 'stack', 'lighthouse', 'gpo', 'guesty', 'statement', 'ai', 'season', 'ramp',
    'rampsteps', 'money', 'video'],
  // 2026-10-27, second: the stack, Lighthouse, listing optimization, distribution and the team
  // came onto the short deck.
  ['market', 'agenda', 'marketing', 'channels', 'direct', 'guestcare', 'revenue', 'gpo', 'guesty',
    'statement', 'ai', 'season', 'ramp', 'rampsteps', 'money', 'video'],
  // 2026-10-27, third: the deck was reordered prospect-first and cut to twelve.
  ['agenda', 'craft', 'dist', 'marketing', 'channels', 'direct', 'guestcare', 'revenue',
    'lighthouse', 'gpo', 'guesty', 'statement', 'ai', 'season', 'ramp', 'rampsteps', 'money',
    'video', 'onbsteps', 'contact'],
  // 2026-10-27, fourth: returns by building, the slide Nick asks for on every call.
  ['agenda', 'craft', 'dist', 'marketing', 'channels', 'direct', 'guestcare', 'revenue',
    'lighthouse', 'gpo', 'guesty', 'statement', 'ai', 'season', 'ramp', 'rampsteps', 'money',
    'video', 'onbsteps', 'contact', 'returns'],
  // 2026-10-27, fifth: the projection page's own range, monthly bars and comparable listings.
  ['agenda', 'craft', 'dist', 'marketing', 'channels', 'direct', 'guestcare', 'revenue',
    'lighthouse', 'gpo', 'guesty', 'statement', 'ai', 'season', 'ramp', 'rampsteps', 'money',
    'video', 'onbsteps', 'contact', 'returns', 'comps'],
  // 2026-10-27, sixth: our homes against the market (the edge slide) joins the short deck.
  ['agenda', 'craft', 'dist', 'marketing', 'channels', 'direct', 'guestcare', 'revenue',
    'lighthouse', 'gpo', 'guesty', 'statement', 'ai', 'season', 'ramp', 'rampsteps', 'money',
    'video', 'onbsteps', 'contact'],
]

// Lines this deck used to open with. Replaced in place on a deck that still carries them, exactly
// as lib/onboarding-copy does for the onboarding deck, and never on one someone has edited.
export const SALES_RETIRED_HERO = [
  'A hospitality company that runs whole buildings, offered to one property at a time.',
]
export const SALES_RETIRED_WELCOME = [
  'What follows is how we would run your property: the people, the technology, the marketing, and what the first four weeks look like. Every number in it is one you can check, and every claim is one we can show you the record of.',
]
export const SALES_HERO = 'The revenue management, the tools and the team around the success of your property.'
export const SALES_WELCOME = 'Three things decide what a property earns: how the rate is managed, the tools the operation runs on, and the team that actually shows up. What follows is all three, plus what the first four weeks look like. Every number in it is one you can check, and every claim is one we can show you the record of.'

// ── 13 · HOW WE GET MAX REVENUE ─────────────────────────────────────────────
// The short deck's one revenue slide. The full deck argues this across five — pricing, the comp
// set, distribution, the listing craft, direct — and each of those is a better slide than this
// one. This is the version for someone who has given us ninety seconds.
export const MAXREV_HEADLINE = 'How we earn you more'
export const MAXREV_SUBTITLE = 'Five levers, worked every day.'
export const MAXREV_BODY =
  'Revenue is not one decision at the start. It is a rate moved daily against live demand, on a listing built to convert, sold in every place a guest might look.'
export const MAXREV_ROWS: KV[] = [
  { k: 'Priced every day', v: 'A named revenue manager at Pacer works your rate daily against live demand, your comp set and the dates ahead.' },
  { k: 'Sold in 40+ places', v: 'One calendar, every major channel and a long tail of partners. A booking can arrive from anywhere.' },
  { k: 'Built to convert', v: 'Photography, title, the first three images and the amenities set by us. A listing that converts ranks higher.' },
  { k: 'The nights others leave empty', v: 'Minimum stays worked by date, gap nights priced to fill, big weekends captured months out.' },
  { k: 'Direct, with no commission', v: 'Our own site and the guest profiles every stay builds bring past guests back with no channel cut.' },
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
    // A measured rate is rarely round. 10.1 prints as 10.1 and 20 prints as 20, because rounding
    // a measured 10.1 up to "about 20" is how a sales slide gets caught by a statement.
    { k: 'Management fee', v: (Math.round(mgmtPct * 10) / 10) + '% of rental revenue', hint: '' },
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
// The two bases are named exactly as the owner reports name them (lib/basis), because the person
// reading this slide may be holding one of those reports a month later.
export const PROOF_NOTE =
  'Revenue only. Gross is accommodation plus cleaning; net of fees is accommodation after the channel takes its commission. Expenses belong to each owner and are not shown here.'

// ── 16 · THE PROJECTION ─────────────────────────────────────────────────────
// Jon: "make it possible to upload projections and build them into the deck for the property."
// THE SHAPE OF THE PAGE THE TEAM ALREADY SENDS (2026-10-27). Jon sent the live one-pager — Stay
// Revenue Projection, Domus Brickell Park, two-bedroom — and described how it is built: a
// PriceLabs revenue estimate for the building, bedroom count and size, checked against our own
// statements where we run units nearby, with eight or nine Airbnb comps from the same building
// and the unit's size, floor and view off the MLS listing. The range runs from the PriceLabs
// midpoint to its top-of-range figure, the uplift split between nightly rate and occupancy, and
// the monthly bars follow PriceLabs seasonality.
//
// EVERY PROJECTION IS LABELLED FULLY RAMPED, and that is not a disclaimer — it is the single most
// important sentence on the page. It assumes an established listing with reviews and booking
// history, so year one can run lower, and an owner who reads the number as a year-one promise is
// an owner we lose in month six.
export const PLAN_HEADLINE = 'What your property could earn'
export const PLAN_SUBTITLE = ''
export const PLAN_BODY =
  'Built from a market revenue estimate for this building, bedroom count and size, checked against what our own units nearby actually earned.'
export const PLAN_NOTE =
  'Figures are fully ramped projections, assuming an established listing with reviews and booking history.'
export const PLAN_LABELS = {
  annual: 'Projected annual revenue',
  annualSub: 'Gross rental revenue a year, once fully ramped',
  monthly: 'Per month',
  monthlySub: 'Average rental revenue a month',
  rate: 'Projected nightly rate',
  rateSub: 'Average daily rate',
  occ: 'Projected occupancy',
  occSub: 'Average across the year',
  byMonth: 'Projected revenue by month',
  base: 'Base',
  high: 'High end',
  baseRate: 'Base nightly rate',
  baseOcc: 'Base occupancy',
}

// ── 19 · THE COMPARABLE LISTINGS ────────────────────────────────────────────
// The second half of the one-pager: the top-earning listings of the same size in the same
// building, which is the evidence an owner checks first because they can open every one of them
// in a browser. Hand-gathered today — there is no comp feed in this system — so the slide takes a
// paste and formats it, rather than pretending to a source we do not have.
export const COMPS_HEADLINE = 'Top-earning comparable listings nearby'
export const COMPS_SUBTITLE = ''
export const COMPS_BODY = ''
export const COMPS_NOTE =
  'Live listings in and around this building, at the same size. Estimated annual revenue, nightly rate and occupancy as published.'

// ── 17 · THEIR PROPERTY ─────────────────────────────────────────────────────
// Jon, 2026-10-27: "a clean, streamlined deck that shows their listing, about their area... It
// should have photos."
//
// The second slide of a proposal is the prospect's own property, because that is the only subject
// they are certain to care about and the fastest proof that this deck was made for them rather
// than printed in a stack. Where the property is already on our account the facts and the
// photographs fill themselves; where it is not, they are four fields and a picker.
export const PROPERTY_HEADLINE = 'Your property'
export const PROPERTY_SUBTITLE = ''
export const PROPERTY_BODY = ''
export const PROPERTY_FACT_HINTS: Record<string, string> = {
  'The unit': 'Bedrooms, bathrooms, how many it sleeps',
  'The building': 'Building or community, and what it offers a guest',
  'Where it is': 'Neighbourhood, and what is within a walk',
  'What it sells': 'The one thing a guest books this property for',
}
export const PROPERTY_FACTS: KV[] = [
  { k: 'The unit', v: '' },
  { k: 'The building', v: '' },
  { k: 'Where it is', v: '' },
  { k: 'What it sells', v: '' },
]

// The market slide takes an uploaded report the same way the projection does — see
// /api/reports/sales-plan, which reads a PDF, a screenshot, a spreadsheet or a CSV and will refuse
// rather than invent. Until something is written or read in, the slide does not print.
export const MARKET_BODY = ''

// ── 20 · WHY OWNERS SWITCH — OUR HOMES AGAINST THE MARKET ───────────────────
// Raskin's order for a sales story is the change, then who wins and who loses, then the promised
// land, then the proof. This is the winners-and-losers slide, and it is made of numbers rather
// than adjectives: what homes we run earned, against what the same size of home earned across the
// market, on the same window (lib/sales-edge). The headline is the takeaway, written once the
// numbers are in; the copy below is only the frame around them.
export const EDGE_HEADLINE = 'Our homes out-earn the market'
export const EDGE_SUBTITLE = 'Same size of home, same twelve months.'
export const EDGE_BODY =
  'Most homes in this market are run by their owners, or by a manager who lists them and waits. The gap between that and a home that is priced, sold and serviced every day is not a few percent.'
export const EDGE_NOTE =
  'Ours: every home we ran for the whole twelve months, all channels, gross booking revenue. Theirs: entire homes listed all twelve months, Airbnb booking revenue.'

// ── 18 · REAL RETURNS BY BUILDING ───────────────────────────────────────────
// Nick Carline's brief, 2026-10-27: "Real returns by building. Annual gross, occupancy and nightly
// rate for the buildings we run (District 225, NoMad, Elser, Arya, the Amrit)."
//
// The single most useful slide in a deck going to lenders and brokers, because it is the one claim
// nobody else in this market can make with their own numbers. Buildings, not owners: no owner is
// named and no expense appears, so it can be forwarded to anybody.
export const RETURNS_HEADLINE = 'What the buildings we run actually earn'
export const RETURNS_SUBTITLE = 'Twelve months of settled bookings, by building.'
export const RETURNS_BODY =
  'Not a case study chosen because it flattered us. Every building we operate with a full year behind it, on the same basis, in one table.'
export const RETURNS_NOTE =
  'Gross is accommodation plus cleaning, as the guest paid it. Revenue only — no expenses, and no owner is identified.'

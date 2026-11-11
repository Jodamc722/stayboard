// THE WORDING PASS (Jon, 2026-11-11: "do an audit of the language and how things are communicated —
// wording can be a bit weird"). Every sentence the sales deck and the magazine carry by default was
// read for: plain meaning, one idea per sentence, no internal jargon ("fully ramped", "the turn"),
// no claim we cannot show ("in seconds"), counts that match ("five levers" over four), and American
// spelling. The new wording is in the source copy (lib/sales-copy, lib/sales-cma, the magazine).
//
// Decks already made carry the old sentences in their own saved content. They are swapped here as the
// deck is read (app/r/[code]), sentence for sentence — only text that still matches the old default
// exactly, so anything the team rewrote by hand is left alone.
export const REWORD: [string, string][] = [
  // operations
  ['Our own people, on our own payroll, running the same day every day.', 'Our own people, on our own payroll, working to one standard every day.'],
  ['Nobody is dispatched from an app and hoped for. Every market has its own crew, its own supervisor and its own escalation path, and every job carries a checklist, an assignee, a timestamp and photographs.', 'We never hand your home to a stranger booked through an app. Every market has its own crew, its own supervisor and its own escalation path, and every job is logged with a checklist, a name, a time and photos.'],
  ['Tomorrow\'s departures, arrivals and same-day turns are scheduled and assigned by name before anyone goes to bed.', 'Tomorrow\'s check-outs, check-ins and same-day turnovers are scheduled and assigned to a named person the evening before.'],
  ['Departure clean against the standard checklist, photographed as it runs. A same-day turn is flagged as one.', 'Every check-out is cleaned to our standard checklist and photographed as it goes. Same-day turnovers are flagged and done first.'],
  ['A supervisor stands in the unit before the guest does, against a fixed list. Not a glance from the doorway.', 'A supervisor walks the home with a set checklist before every arrival. Not a glance from the doorway.'],
  ['Anything found becomes a tracked job with an owner and a deadline. Preventative work runs on a routine, not when something breaks.', 'Anything we find becomes a tracked job with a person responsible and a deadline. Preventive maintenance runs on a schedule, not only when something breaks.'],
  ['Messages answered around the clock from one inbox. A guest who cannot get in is our emergency, not theirs.', 'Our local team and 24/7 guest support answer every guest message from one inbox. If a guest cannot get in, it is our emergency, not theirs.'],
  // Jon, 2026-11-11: "I would say local team and 24/7 guest support" (not "CCS").
  ['Our 24/7 CCS team answers every guest message from one inbox. If a guest cannot get in, it is our emergency, not theirs.', 'Our local team and 24/7 guest support answer every guest message from one inbox. If a guest cannot get in, it is our emergency, not theirs.'],
  ['Our own housekeeping, maintenance and inspection teams, with a local 24/7 CCS team on every check-in.', 'Our own housekeeping, maintenance and inspection teams: a local team on the ground and 24/7 guest support on every stay.'],
  ['Housekeeping, maintenance, guest care and management in one room, in two languages. A problem reaches whoever can fix it in seconds.', 'Our 24/7 guest care team, our local team on the ground and a list of trusted vendors make sure guest issues are resolved quickly.'],
  // Jon, 2026-11-11: "escalation being solved in seconds — I would say we have a 24/7 guest care team and a local team and a list of trusted vendors to ensure guest issues are resolved quickly"
  ['Housekeeping, maintenance, guest care and management work as one team, in two languages. A problem goes straight to the person who can fix it.', 'Our 24/7 guest care team, our local team on the ground and a list of trusted vendors make sure guest issues are resolved quickly.'],
  ['All of it is recorded as it happens, so readiness is documented rather than assumed — and so the answer to "what happened at my property last Tuesday" is a record, not a recollection.', 'Everything is logged as it happens. Ask what happened at your home last Tuesday, and we show you the record, not a recollection.'],
  // distribution, direct, Lighthouse
  ['A property on one channel sells at the speed of one audience. Yours is published across every major channel and a long tail of partners from a single calendar, so a booking can arrive from wherever it arrives and two guests can never book the same night.', 'A home listed on one channel reaches one audience. Yours is listed on every major channel and 40+ partner sites from one calendar, so bookings come from everywhere and two guests can never book the same night.'],
  ['Which channels carry which dates, and where a slow window gets pushed. A soft March is worked in December.', 'Which channels carry which dates, and where a slow stretch gets a push. We work on a slow March in December.'],
  ['is how a share of your nights arrive without a channel in the middle.', 'is how more of your nights are booked with no channel in the middle.'],
  ['Most managers run on the same three or four bought platforms as everyone else, and live with the gaps between them. We built the layer that closes those gaps — and it is the reason the answer to a question about your property is a screen rather than a phone call to somebody who might remember.', 'Most managers run on the same three or four off-the-shelf platforms and live with the gaps between them. We built the software that closes those gaps, so any question about your home is answered from live data, not from someone’s memory.'],
  ['The report you receive is generated from this same data, so nothing is retyped on the way to you. And none of it is yours to learn or log into — it exists so the people running your property are never working from memory.', 'Your monthly report comes from the same data, so nothing is retyped along the way. There is nothing for you to learn or log into: it is there so the people running your home always work from the facts.'],
  ['Five levers, worked every day.', 'Four levers, worked every day.'],
  // onboarding and furnishing
  ['The calendar goes live across every channel at once, into the new-listing promotion window each channel grants exactly once.', 'The calendar goes live on every channel at once, timed to use the one-time new-listing boost each channel offers.'],
  ['We walk your finished listing with you channel by channel, agree the strategy, and answer everything. You get that session as a document.', 'We walk you through your finished listing on each channel, agree on the strategy, and answer every question. You get a written summary afterwards.'],
  ['Furnishing a short-term rental well is the biggest cheque an owner writes before the first guest arrives. Through our HostGPO group-purchasing membership, that cheque is written at member pricing across a catalogue of brands, and you do not need an account, a minimum order or a membership of your own to use it.', 'Furnishing a short-term rental well is the biggest check an owner writes before the first guest arrives. Through our HostGPO group-purchasing membership, you pay member pricing across a catalog of brands, with no account, minimum order or membership of your own.'],
  ['recognised brands through group-purchasing agreements rather than whatever is in stock locally.', 'recognized brands through group-purchasing agreements, not whatever is in stock locally.'],
  ['Our membership rate on the catalogue, with the terms the group negotiated rather than the retail price in front of a single buyer.', 'Our membership rate across the catalog, on terms the group negotiated, not the retail price a single buyer pays.'],
  // projections
  ['Figures are fully ramped projections, assuming an established listing with reviews and booking history.', 'Projections assume an established listing, with reviews and a booking history.'],
  ['Gross rental revenue a year, once fully ramped', 'Gross rental revenue a year, once established'],
  ['Stay projection, fully ramped', 'Stay projection, established listing'],
  ['units that pushed price at the March and April peak gave back bookings into summer. The owners who do best fill the calendar first and raise rates only where demand supports it.', 'units that priced too high at the March and April peak lost bookings into the summer. The owners who do best fill the calendar first and raise rates only where demand supports it.'],
  ['Occupancy-first pricing, daily rate changes, a fast and clean turnover, and fast answers to guests. Review scores follow operations, and reviews drive the next booking.', 'Pricing for occupancy first, daily rate changes, fast and spotless turnovers, and quick replies to guests. Good operations earn good reviews, and reviews win the next booking.'],
  ['Art Basel week and New Year’s Eve carry a large premium to the base rate. A unit live and reviewed before then is positioned for it.', 'Art Basel week and New Year’s Eve command a large premium over the base rate. A unit that is live and reviewed before then is ready to capture it.'],
  ['A brand-new building opens with new furnishings, fresh photos and launch-period demand, and has no aging inventory to discount.', 'A brand-new building opens with new furnishings, fresh photos and launch-period demand, with nothing worn or dated to discount.'],
  ['opening with new furnishings, no aging inventory and launch-period demand.', 'opening with new furnishings, nothing dated and launch-period demand.'],
  ['Estimates for a fully ramped, furnished unit once the building is operating', 'Estimates for a furnished unit with an established listing, once the building is operating'],
  ['Comparable figures are Stay projections for fully ramped units;', 'Comparable figures are Stay projections for established units;'],
  ['Housekeeping, maintenance, guest care and management in one room, in real time, in two languages. A problem at your property reaches whoever can fix it in seconds.', 'Housekeeping, maintenance, guest care and management on one channel, in real time, in two languages. A problem at your property goes straight to the person who can fix it.'],
  ['Estimates for a fully ramped, furnished unit. Projections', 'Estimates for a furnished unit with an established listing. Projections'],
  ['Property and neighbourhood pages', 'Property and neighborhood pages'],
  // spelling
  ['Neighbourhood, and what is within a walk', 'Neighborhood, and what is within a walk'],
  ['Why a guest chooses this neighbourhood:', 'Why a guest chooses this neighborhood:'],
  ['The property and the neighbourhood shown the way a guest would experience them', 'The property and the neighborhood shown the way a guest would experience them'],
]

/** Short labels swapped only when the whole string matches (a substring swap would catch "The turnover"). */
export const REWORD_EXACT: Record<string, string> = { 'The turn': 'The clean', 'Labour': 'Labor' }

/** Swap old default sentences for the new ones, anywhere in a deck's saved content. */
export function reword<T>(v: T): T {
  if (typeof v === 'string') { if (REWORD_EXACT[v]) return REWORD_EXACT[v] as any; let s: string = v; for (const [a, b] of REWORD) if (s.includes(a)) s = s.split(a).join(b); return s as any }
  if (Array.isArray(v)) return v.map(reword) as any
  if (v && typeof v === 'object') { const o: any = {}; for (const [k, x] of Object.entries(v as any)) o[k] = reword(x); return o }
  return v
}

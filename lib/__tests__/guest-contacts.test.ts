// THE RELAY TEST.
//
// Most "email addresses" an OTA hands over are forwarding aliases — a1b2c3@guest.airbnb.com and
// friends. They expire when the booking closes, they bounce, and Airbnb's terms forbid marketing to
// them. If one of these ever classifies as `mailable`, Lighthouse will upload it to Mailchimp:
// money spent on dead contacts, a damaged sending reputation, and a channel-terms problem.
//
// The second half guards the marketing share link. audienceSummary() is the ONLY contact data that
// leaves the app on a public URL, and it must be counts and labels — never a name, address or phone.
import { classifyEmail, splitName, buildContacts, audienceSummary, LOW_RATING_MAX } from '../guest-contacts'
let fail = 0
const eq = (label: string, got: any, want: any) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { console.log('FAIL', label, '\n  got ', g, '\n  want', w); fail++ } else console.log('ok  ', label)
}

// relays must never be mailable
for (const e of ['a1b2@guest.airbnb.com','x@reply.airbnb.com','y@guest.booking.com','z@m.vrbo.com','q@messages.homeaway.com','w@stay.expedia.com'])
  eq('relay ' + e, classifyEmail(e).state, 'relay')
// real addresses must be
for (const e of ['jon@stay-hospitality.com','maria.garcia+tag@gmail.com','X@Y.CO.UK'])
  eq('mailable ' + e, classifyEmail(e).state, 'mailable')
// a real address that merely mentions a channel is NOT a relay
eq('not-a-relay airbnbfan@gmail.com', classifyEmail('airbnbfan@gmail.com').state, 'mailable')
eq('junk noreply', classifyEmail('noreply@acme.com').state, 'invalid')
eq('junk domain', classifyEmail('a@test.invalid').state, 'invalid')
eq('empty', classifyEmail('').state, 'none')
eq('garbage', classifyEmail('not an email').state, 'invalid')

eq('name plain', splitName('John Smith'), { first: 'John', last: 'Smith', full: 'John Smith' })
eq('name comma', splitName('Smith, John'), { first: 'John', last: 'Smith', full: 'John Smith' })
eq('name shouting', splitName('MARIA GARCIA LOPEZ'), { first: 'Maria', last: 'Garcia Lopez', full: 'Maria Garcia Lopez' })
eq('name title', splitName('Dr. Alice Chen'), { first: 'Alice', last: 'Chen', full: 'Alice Chen' })
eq('name suffix', splitName('Bob Jones Jr.'), { first: 'Bob', last: 'Jones', full: 'Bob Jones' })
eq('name single', splitName('Cher'), { first: 'Cher', last: '', full: 'Cher' })
eq('name mixedcase kept', splitName('Ronald McDonald').last, 'McDonald')
eq('name empty', splitName(null), { first: '', last: '', full: '' })

// address_city, NOT city. The column is called address_city everywhere else in the repo; the first
// version of this shipped selecting `city`, PostgREST answered with an error, pageRows turned that
// into zero listings, and every single contact came back with no building and market "Unknown" —
// silently, with the page looking fine. Both spellings are accepted; this pins that they work.
const listings = [
  { id: 'L1', nickname: 'Rustic 10 - 1BR', building: 'Rustic', address_city: 'Fort Lauderdale' },
  { id: 'L2', nickname: 'Eden 1203 - Suite', building: 'Eden', city: 'Miami' },
]
const res = [
  { listing_id: 'L1', guest_name: 'JOHN SMITH', guest_email: 'j@guest.airbnb.com', guest_phone: '+1 954 555 0101', check_in: '2026-01-10', check_out: '2026-01-14', nights: 4, status: 'checked_out', source: 'airbnb2', money_total: 800, guest_id: 'G1' },
  // same person, later, booked direct with a real address -> real address must win, channel = Direct
  { listing_id: 'L1', guest_name: 'John Smith', guest_email: 'j@guest.airbnb.com', guest_phone: '+1 954 555 0101', check_in: '2026-06-01', check_out: '2026-06-05', nights: 4, status: 'confirmed', source: 'website', money_total: 900, guest_id: 'G1' },
  { listing_id: 'L2', guest_name: 'Maria Garcia', guest_email: 'maria@gmail.com', check_in: '2026-03-01', check_out: '2026-03-03', nights: 2, status: 'confirmed', source: 'vrbo', money_total: 400, guest_id: 'G2' },
  // cancelled must not count
  { listing_id: 'L2', guest_name: 'Ghost Person', guest_email: 'ghost@gmail.com', check_in: '2026-03-01', check_out: '2026-03-03', nights: 2, status: 'cancelled', source: 'vrbo', money_total: 400, guest_id: 'G9' },
]
// guesty_reviews.guest_name is null on the rows this account actually holds, so attribution runs
// off the STAY: the review belongs to whoever last checked out of that unit before it appeared.
const reviews = [
  // nameless, 6 days after John's 2026-01-14 checkout -> John
  { listing_id: 'L1', guest_name: null, rating: 5, created_at: '2026-01-20' },
  // nameless, 5 days after John's 2026-06-05 checkout -> John
  { listing_id: 'L1', guest_name: null, rating: 4, created_at: '2026-06-10' },
  // named, and the name wins outright
  { listing_id: 'L2', guest_name: 'Maria Garcia', rating: 3, created_at: '2026-03-10' },
  // far outside the window after any checkout at L1 -> nobody
  { listing_id: 'L1', guest_name: null, rating: 1, created_at: '2026-12-25' },
  // a unit nobody in this set ever stayed in -> nobody
  { listing_id: 'L9', guest_name: null, rating: 1, created_at: '2026-01-20' },
]
const cs = buildContacts({ reservations: res as any, listings: listings as any, reviews: reviews as any, profiles: [], today: '2026-09-14' })
eq('contact count (cancelled dropped)', cs.length, 2)
const john = cs.find(c => c.key === 'e:j@guest.airbnb.com')!
eq('john stays', john.stays, 2)
eq('john channel is most recent', john.channel, 'Direct')
eq('john everDirect', john.everDirect, true)
eq('john channels', john.channels, ['Airbnb', 'Direct'])
eq('john relay email still visible', john.email, 'j@guest.airbnb.com')
eq('john not mailable', john.mail, 'relay')
eq('john gets both nameless reviews via his stays', john.reviews, 2)
eq('john review avg', john.reviewAvg, 4.5)
eq('john building', john.lastBuilding, 'Rustic')
eq('john market resolved from address_city', john.markets.includes('Unknown'), false)
eq('john name split', [john.first, john.last], ['John', 'Smith'])
const maria = cs.find(c => c.key === 'e:maria@gmail.com')!
eq('maria mailable', maria.mail, 'mailable')
eq('maria credited by name on her own unit', maria.reviews, 1)
eq('maria channel', maria.channel, 'Vrbo')

// AMBIGUITY. Two different guests check out of the same unit a day apart; a review lands four days
// later. There is no honest way to say whose it is, so it must be credited to NEITHER.
const ambRes = [
  { listing_id: 'L1', guest_name: 'Alice A', guest_email: 'alice@gmail.com', check_in: '2026-04-01', check_out: '2026-04-05', nights: 4, status: 'checked_out', source: 'website', money_total: 100 },
  { listing_id: 'L1', guest_name: 'Bob B', guest_email: 'bob@gmail.com', check_in: '2026-04-05', check_out: '2026-04-06', nights: 1, status: 'checked_out', source: 'website', money_total: 100 },
]
const ambCs = buildContacts({
  reservations: ambRes as any, listings: listings as any,
  reviews: [{ listing_id: 'L1', guest_name: null, rating: 5, created_at: '2026-04-10' }] as any,
  profiles: [], today: '2026-09-14',
})
eq('ambiguous review credited to nobody', ambCs.reduce((a, c) => a + c.reviews, 0), 0)

// And the unambiguous version of the same shape IS credited.
const clearCs = buildContacts({
  reservations: [ambRes[0]] as any, listings: listings as any,
  reviews: [{ listing_id: 'L1', guest_name: null, rating: 5, created_at: '2026-04-10' }] as any,
  profiles: [], today: '2026-09-14',
})
eq('unambiguous review is credited', clearCs.reduce((a, c) => a + c.reviews, 0), 1)

// THE CHANNEL RULE (Jon, 2026-09-14: "we can not send email / content to expedia guests").
//
// Unlike Airbnb, Expedia hands over the guest's REAL address, so the relay check waves it through.
// The block has to come from the channel, not the mailbox. And a guest who later books direct is
// ours again — that is the win-back list, and it must not be blocked.
const expRes = [
  { listing_id: 'L1', guest_name: 'Ellen Expedia', guest_email: 'ellen@gmail.com', check_in: '2026-02-01', check_out: '2026-02-04', nights: 3, status: 'checked_out', source: 'expedia', money_total: 500 },
  { listing_id: 'L1', guest_name: 'Hal Hotels', guest_email: 'hal@gmail.com', check_in: '2026-02-01', check_out: '2026-02-04', nights: 3, status: 'checked_out', source: 'hotels.com', money_total: 500 },
  // came via Expedia, came BACK direct -> ours
  { listing_id: 'L1', guest_name: 'Wanda Winback', guest_email: 'wanda@gmail.com', check_in: '2026-01-01', check_out: '2026-01-04', nights: 3, status: 'checked_out', source: 'expedia', money_total: 500 },
  { listing_id: 'L1', guest_name: 'Wanda Winback', guest_email: 'wanda@gmail.com', check_in: '2026-05-01', check_out: '2026-05-04', nights: 3, status: 'checked_out', source: 'website', money_total: 500 },
  // a channel NOT on the blocked list stays mailable
  { listing_id: 'L1', guest_name: 'Abe Airbnb', guest_email: 'abe@gmail.com', check_in: '2026-02-01', check_out: '2026-02-04', nights: 3, status: 'checked_out', source: 'airbnb2', money_total: 500 },
]
const expCs = buildContacts({ reservations: expRes as any, listings: listings as any, reviews: [], profiles: [], today: '2026-09-14' })
const by = (e: string) => expCs.find(c => c.email === e)!
eq('expedia guest is blocked despite a real address', by('ellen@gmail.com').mail, 'restricted')
eq('expedia guest is flagged restricted', by('ellen@gmail.com').restricted, true)
eq('hotels.com counts as Expedia Group', by('hal@gmail.com').mail, 'restricted')
eq('a later direct booking wins them back', by('wanda@gmail.com').mail, 'mailable')
eq('win-back is not flagged restricted', by('wanda@gmail.com').restricted, false)
eq('an unblocked channel stays mailable', by('abe@gmail.com').mail, 'mailable')

// The blocked list is configurable, not baked in.
const bothBlocked = buildContacts({
  reservations: expRes as any, listings: listings as any, reviews: [], profiles: [], today: '2026-09-14',
  restrictedChannels: ['Expedia Group', 'Airbnb'],
})
eq('adding Airbnb to the list blocks Airbnb', bothBlocked.find(c => c.email === 'abe@gmail.com')!.mail, 'restricted')
const noneBlocked = buildContacts({
  reservations: expRes as any, listings: listings as any, reviews: [], profiles: [], today: '2026-09-14',
  restrictedChannels: [],
})
eq('an empty list blocks nobody', noneBlocked.find(c => c.email === 'ellen@gmail.com')!.mail, 'mailable')

// And the summary must count them apart from everyone else.
const expSum = audienceSummary(expCs)
eq('summary counts the restricted', expSum.restricted, 2)
eq('restricted are not counted as mailable', expSum.mailable, 2)   // Wanda + Abe

const s = audienceSummary(cs)
eq('summary mailable', s.mailable, 1)
eq('summary relay', s.relay, 1)
eq('summary repeat', s.repeat, 1)
// The real test: nothing a person could be identified by may appear anywhere in the payload.
const blob = JSON.stringify(s)
eq('summary carries no address', /@/.test(blob), false)
eq('summary carries no guest name', /Smith|Maria|Garcia|John/i.test(blob), false)
eq('summary carries no phone', /555|\+1/.test(blob), false)
eq('summary is counts and labels only', Object.values(s).every(v => typeof v === 'number' || Array.isArray(v)), true)

// ── A BAD REVIEW STOPS THE MARKETING (Jon, 2026-09-15) ─────────────────────────────────────────
// The test is the LOWEST rating, not the average, and it has to survive the review-attribution
// rules: a review is attached to whoever last checked out of that unit inside the window.
const lowListings = [{ id: 'L9', nickname: 'Nine', building: 'Eden', address_city: 'Miami' }]
const lowRes = [
  // Happy: two stays, two good reviews.
  { listing_id: 'L9', guest_id: 'g1', guest_name: 'Happy Hannah', guest_email: 'hannah@gmail.com',
    check_in: '2026-01-01', check_out: '2026-01-05', nights: 4, status: 'checked_out', source: 'Direct' },
  // Mixed: loved three, hated one. Average is well over 3; the low is 2.
  { listing_id: 'L9', guest_id: 'g2', guest_name: 'Mixed Mike', guest_email: 'mike@gmail.com',
    check_in: '2026-03-01', check_out: '2026-03-05', nights: 4, status: 'checked_out', source: 'Direct' },
  { listing_id: 'L9', guest_id: 'g2', guest_name: 'Mixed Mike', guest_email: 'mike@gmail.com',
    check_in: '2026-05-01', check_out: '2026-05-05', nights: 4, status: 'checked_out', source: 'Direct' },
  // Exactly on the line: a 3 is still a 3.
  { listing_id: 'L9', guest_id: 'g3', guest_name: 'Borderline Bea', guest_email: 'bea@gmail.com',
    check_in: '2026-07-01', check_out: '2026-07-05', nights: 4, status: 'checked_out', source: 'Direct' },
]
const lowRev = [
  { listing_id: 'L9', guest_name: null, rating: 5, created_at: '2026-01-07' },
  { listing_id: 'L9', guest_name: null, rating: 5, created_at: '2026-03-07' },
  { listing_id: 'L9', guest_name: null, rating: 2, created_at: '2026-05-07' },
  { listing_id: 'L9', guest_name: null, rating: 3, created_at: '2026-07-07' },
]
const lowCs = buildContacts({
  reservations: lowRes as any, listings: lowListings as any, reviews: lowRev as any, profiles: [],
  today: '2026-09-15',
})
const byMail = (e: string) => lowCs.find(c => c.email === e)!
eq('the threshold is 3 stars', LOW_RATING_MAX, 3)
eq('a happy guest is still marketable', byMail('hannah@gmail.com').unhappy, false)
eq('a 5 leaves the low at 5', byMail('hannah@gmail.com').reviewLow, 5)
eq('one bad stay out of two is enough', byMail('mike@gmail.com').unhappy, true)
eq('the low is the low, not the average', byMail('mike@gmail.com').reviewLow, 2)
eq('the average would have passed', (byMail('mike@gmail.com').reviewAvg || 0) > 3, true)
eq('exactly 3 is excluded', byMail('bea@gmail.com').unhappy, true)
eq('a guest with no review is not unhappy', lowCs.every(c => c.reviews > 0 || !c.unhappy), true)

const lowSum = audienceSummary(lowCs)
eq('summary counts the unhappy', lowSum.unhappy, 2)
eq('will-email excludes them', lowSum.mailableAfterUnhappy, lowSum.mailable - 2)

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed')
process.exit(fail ? 1 : 0)

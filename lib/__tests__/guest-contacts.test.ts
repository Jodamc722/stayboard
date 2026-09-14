// THE RELAY TEST.
//
// Most "email addresses" an OTA hands over are forwarding aliases — a1b2c3@guest.airbnb.com and
// friends. They expire when the booking closes, they bounce, and Airbnb's terms forbid marketing to
// them. If one of these ever classifies as `mailable`, Lighthouse will upload it to Mailchimp:
// money spent on dead contacts, a damaged sending reputation, and a channel-terms problem.
//
// The second half guards the marketing share link. audienceSummary() is the ONLY contact data that
// leaves the app on a public URL, and it must be counts and labels — never a name, address or phone.
import { classifyEmail, splitName, buildContacts, audienceSummary } from '../guest-contacts'
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

const listings = [
  { id: 'L1', nickname: 'Rustic 10 - 1BR', building: 'Rustic', city: 'Fort Lauderdale' },
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
const reviews = [
  { listing_id: 'L1', guest_name: 'John Smith', rating: 5, created_at: '2026-01-20' },
  { listing_id: 'L1', guest_name: 'john  smith', rating: 4, created_at: '2026-06-10' },
  // a Maria Garcia who reviewed a unit OUR Maria never stayed in must not be credited
  { listing_id: 'L1', guest_name: 'Maria Garcia', rating: 1, created_at: '2026-02-01' },
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
eq('john reviews counted once per unit', john.reviews, 2)
eq('john review avg', john.reviewAvg, 4.5)
eq('john building', john.lastBuilding, 'Rustic')
eq('john name split', [john.first, john.last], ['John', 'Smith'])
const maria = cs.find(c => c.key === 'e:maria@gmail.com')!
eq('maria mailable', maria.mail, 'mailable')
eq('maria NOT credited with other-unit review', maria.reviews, 0)
eq('maria channel', maria.channel, 'Vrbo')

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

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed')
process.exit(fail ? 1 : 0)

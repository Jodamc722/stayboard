// node lib/__tests__/listing-watch.test.mjs
// THE LISTING WATCH (Jon, 2026-11-24): which properties have no cleaning fee, which listings are
// offline on Airbnb, when Eve says so in the leadership room, and what the message reads.
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return n(s + '.ts', c); throw e } }"))
const S = await import('../admin-desk-shared.ts')
const W = await import('../listing-watch-rules.ts')
const { cleaningFeeOf, noCleaningFee, airbnbOffline, isTestListing, rowInTile, tileCounts, worklist, rowWeight } = S
const { feeItems, airbnbItems, decide, nextSide, feeMessage, airbnbMessage, cleanWatchState } = W

let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))

const today = '2026-11-24'
const cell = (verdict, extra = {}) => ({ verdict, status: verdict === 'missing' ? null : 'COMPLETED', approval: null, url: null, lastBookingAt: null, bookings90d: 0, since: null, ...extra })
const row = (over = {}) => ({
  id: 'a'.repeat(24), name: 'Capri 205 - 1BR', building: 'Capri', market: 'Broward', active: true, guestyStatus: 'active',
  channels: { airbnb2: cell('live'), bookingCom: cell('live'), homeaway2: cell('live'), expedia: cell('live') }, verdict: 'live', score: 82, lastOptimized: '2026-11-01T12:00:00Z',
  photos: { count: 32, noCaption: 0, analyzedAt: '2026-11-01T12:00:00Z', photoScore: 78 },
  reviews: { avg: 4.8, count: 40, owed: 0, owedLow: 0, low30: 0, last: '2026-11-20' },
  cleaningFee: 120, listed: true, buildingSlug: 'capri', blocked: null, ...over,
})

// The fee as Guesty holds it
eq('prices.cleaningFee', cleaningFeeOf({ basePrice: 95, cleaningFee: 50 }), 50)
eq('no key at all', cleaningFeeOf({ basePrice: 1500, currency: 'USD' }), null)
eq('zero is no fee', cleaningFeeOf({ cleaningFee: 0 }), null)
eq('a blank string is no fee', cleaningFeeOf({ cleaningFee: '' }), null)
eq('the fee in financials counts when prices has none', cleaningFeeOf({ basePrice: 95 }, { value: { formula: 50, valueType: 'FIXED' } }), 50)
eq('no prices object', cleaningFeeOf(null, null), null)

// Who is flagged
ok('a listing with a fee is fine', !noCleaningFee(row()))
ok('active with no fee is flagged', noCleaningFee(row({ cleaningFee: null })))
ok('not listed yet is still flagged (catch it before it goes live)', noCleaningFee(row({ cleaningFee: null, listed: false })))
ok('offline in Guesty is not', !noCleaningFee(row({ cleaningFee: null, active: false })))
ok("Jon's test listing is not", !noCleaningFee(row({ cleaningFee: null, name: "! Jon's Unit" })) && isTestListing("! Jon's Unit") && !isTestListing('Icon Brickell'))
ok('marked not needed is not', !noCleaningFee(row({ cleaningFee: null, feeExempt: true })))
ok('a row that never read the fee is not guessed at', !noCleaningFee(row({ cleaningFee: undefined })))

// On the desk: its own tile, a red line, first among the non-channel work
const rows = [row(), row({ id: 'b'.repeat(24), name: 'The Crosby', building: 'The Crosby', buildingSlug: 'the-crosby', cleaningFee: null }), row({ id: 'c'.repeat(24), name: 'Icon Brickell', building: 'Icon Brickell', cleaningFee: null, listed: false, buildingSlug: 'icon-brickell' })]
eq('the tile counts them', tileCounts(rows, today).noCleaningFee, 2)
ok('the tile filter shows exactly those', rows.filter(r => rowInTile(r, 'noCleaningFee', today)).map(r => r.name).join() === 'The Crosby,Icon Brickell')
const work = worklist(rows, today)
const fee = work.filter(w => w.kind === 'fee')
eq('one red line each', fee.map(w => [w.name, w.severity, w.verb]), [['Icon Brickell', 'high', 'Set fee'], ['The Crosby', 'high', 'Set fee']])
ok('it says when the listing is not listed yet', /not listed yet/.test(fee[0].title) && !/not listed/.test(fee[1].title))
ok('Set fee opens the building, where the bulk editor is', fee[1].href === '/buildings/the-crosby')
ok('it sorts above a low review reply', (() => { const w = worklist([row({ cleaningFee: null, reviews: { avg: 4, count: 3, owed: 1, owedLow: 1, low30: 1, last: '2026-11-20' } })], today); return w[0].kind === 'fee' && w[1].kind === 'reply' })())
ok('and weighs on the listings sort', rowWeight(row({ cleaningFee: null }), today) >= 90 && rowWeight(row(), today) === 0)

// Offline on Airbnb
ok('live is not offline', !airbnbOffline(row()))
for (const v of ['delisted', 'suspended', 'failed', 'disconnected']) ok(v + ' is offline', airbnbOffline(row({ channels: { airbnb2: cell(v) } })))
ok('never connected is not "offline"', !airbnbOffline(row({ channels: { airbnb2: cell('missing') } })))
ok('quiet (no bookings) is not offline', !airbnbOffline(row({ channels: { airbnb2: cell('stale') } })))
ok('offline on Vrbo only is not an Airbnb matter', !airbnbOffline(row({ channels: { airbnb2: cell('live'), homeaway2: cell('failed') } })))
ok('a listing offline in Guesty is not listed', !airbnbOffline(row({ active: false, channels: { airbnb2: cell('failed') } })))
ok('nor the test listing', !airbnbOffline(row({ name: '! Jon\'s Unit', channels: { airbnb2: cell('failed') } })))

// The two lists
const fi = feeItems(rows)
eq('fee list, by building then name', fi.map(i => [i.name, i.note]), [['Icon Brickell', 'not listed yet'], ['The Crosby', '']])
const ai = airbnbItems([row({ id: 'r2', name: 'Rustic 2 - 1BR', building: 'Rustic', channels: { airbnb2: cell('failed', { since: '2026-10-14T04:03:00Z' }) } }), row({ id: 'c115', name: 'Capri 115 - 1BR', channels: { airbnb2: cell('delisted', { since: '2026-11-20T04:03:00Z' }) } }), row()])
eq('airbnb list says how and since when', ai.map(i => [i.name, i.note, i.since]), [['Capri 115 - 1BR', 'page removed', '2026-11-20'], ['Rustic 2 - 1BR', 'failed', '2026-10-14']])

// When Eve speaks
const empty = { seen: {}, lastDay: '' }
eq('nothing on the list: silent, even in the morning', decide([], empty, today, true).post, false)
const first = decide(fi, empty, today, false)
eq('a listing new to the list is said at once', [first.post, first.fresh.length], [true, 2])
const said = nextSide(fi, empty, today, '2026-11-24T16:03:00Z', true)
eq('once said, the sync run stays quiet', decide(fi, said, today, false).post, false)
eq('and so does a second morning run the same day', decide(fi, said, today, true).post, false)
const tomorrow = decide(fi, said, '2026-11-25', true)
eq('next morning it is repeated, with nothing marked new', [tomorrow.post, tomorrow.fresh], [true, []])
eq('the sync run next day does not repeat it', decide(fi, said, '2026-11-25', false).post, false)
const third = [...fi, { id: 'z', name: 'Capri 115/116', building: 'Capri', note: '', since: null }]
eq('a third one joins: said, and only it is new', decide(third, said, today, false).fresh, ['z'])
const fixed = nextSide([fi[0]], said, '2026-11-25', '2026-11-25T14:07:00Z', true)
eq('a listing that got its fee is forgotten', Object.keys(fixed.seen), [fi[0].id])
eq('so if it loses the fee again it is new again', decide(fi, fixed, '2026-11-26', false).fresh, [fi[1].id])
// A message that did not go out (outside the hours, switch off) marks nothing as said.
const held = nextSide(fi, empty, today, '2026-11-25T04:03:00Z', false)
eq('not sent: still new for the morning run', [Object.keys(held.seen).length, held.lastDay, decide(fi, held, '2026-11-25', true).fresh.length], [0, '', 2])

// The words
const fm = feeMessage(third, ['z'], 'https://x.test', '<@U1> <@U2>')
ok('fee message: the count, the new one first, the tag', /^:red_circle: \*3 properties have no cleaning fee\* · 1 new\n• \*Capri 115\/116\* · \*new\*/.test(fm.body) && fm.body.includes('<@U1> <@U2>'))
ok('it names each property and says not listed yet', fm.body.includes('• *Icon Brickell* · not listed yet') && fm.body.includes('• *The Crosby*'))
ok('it says what it costs and where to fix it', /Guests pay nothing for the clean/.test(fm.body) && fm.body.includes('<https://x.test/admin?tab=listings&show=noCleaningFee|Open the list>'))
const fr = feeMessage(fi, [], 'https://x.test', '<@U1>')
ok('the morning reminder tags nobody and marks nothing new', !fr.body.includes('<@U1>') && !/new/.test(fr.body))
ok('one property reads as one', feeMessage([fi[1]], [fi[1].id], 'https://x.test').body.startsWith(':red_circle: *1 property has no cleaning fee*\n'))
ok('all new: no "new" on every line', !/\*new\*/.test(feeMessage(fi, fi.map(i => i.id), 'https://x.test').body))
const am = airbnbMessage(ai, [], 'https://x.test')
ok('airbnb message', am.body.startsWith(':red_circle: *2 listings are offline on Airbnb*\n') && am.body.includes('• *Capri 115 - 1BR* · page removed · since Nov 20') && am.body.includes('• *Rustic 2 - 1BR* · failed · since Oct 14') && am.body.includes('/admin?tab=channels&channel=airbnb2&problems=1|Open Channels>'))
ok('the building is added only when the name does not carry it', feeMessage([{ id: 'q', name: 'Royal Palm', building: 'Oasis', note: '', since: null }], [], 'u').body.includes('• *Royal Palm* (Oasis)'))
const many = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, name: 'Unit ' + i, building: 'B', note: 'failed', since: null }))
ok('a long list is cut with a count', /…and 5 more/.test(airbnbMessage(many, [], 'u').body))
ok('a name cannot break the message', !/<script>/.test(feeMessage([{ id: 'x', name: '<script>', building: '', note: '', since: null }], [], 'u').body))
eq('state starts empty', cleanWatchState(undefined), { fee: { seen: {}, lastDay: '' }, airbnb: { seen: {}, lastDay: '' }, lastRun: null, lastError: null })

console.log(`listing watch: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// node lib/__tests__/admin-desk.test.mjs
// The Admin desk's rules (Jon, 2026-10-26): which listings need a person, which tile each row counts
// under, and that a tile's number is exactly the rows its click shows.
const { daysSince, agoShort, optimizeState, photoFlags, rowInTile, tileCounts, worklist, channelCounts, rowWeight, RULES } = await import('../admin-desk-shared.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

const today = '2026-10-26'
const cell = (verdict, extra = {}) => ({ verdict, status: verdict === 'missing' ? null : 'COMPLETED', approval: null, url: null, lastBookingAt: null, bookings90d: 0, since: null, ...extra })
const live = { airbnb2: cell('live'), bookingCom: cell('live'), homeaway2: cell('live'), expedia: cell('live'), googleVacationRentals: cell('missing') }
const row = (over = {}) => ({
  id: 'l1', name: '17WEST - 511 - 2BR', building: '17WEST', market: 'Miami', active: true, guestyStatus: 'active',
  channels: live, verdict: 'live', score: 82, lastOptimized: '2026-09-01T12:00:00Z',
  photos: { count: 32, noCaption: 0, analyzedAt: '2026-09-01T12:00:00Z', photoScore: 78 },
  reviews: { avg: 4.8, count: 40, owed: 0, owedLow: 0, low30: 0, last: '2026-10-20' },
  blocked: null, ...over,
})

// ── dates ──
eq('days since', daysSince('2026-10-01T05:00:00Z', today), 25)
eq('days since none', daysSince(null, today), null)
eq('ago short days', agoShort('2026-10-23', today), '3d')
eq('ago short months', agoShort('2026-07-01', today), '4mo')
eq('ago short never', agoShort(null, today), 'never')

// ── optimize state ──
eq('fresh and scored is ok', optimizeState({ score: 82, lastOptimized: '2026-09-01' }, today), 'ok')
eq('never written', optimizeState({ score: 70, lastOptimized: null }, today), 'never')
eq('low score beats a recent date', optimizeState({ score: 55, lastOptimized: '2026-10-01' }, today), 'low')
eq('stale after 180 days', optimizeState({ score: 80, lastOptimized: '2026-03-01' }, today), 'stale')

// ── photo flags ──
eq('healthy photos', photoFlags({ count: 32, noCaption: 1, analyzedAt: '2026-09-01', photoScore: 80 }, today), [])
eq('few photos', photoFlags({ count: 9, noCaption: 0, analyzedAt: '2026-09-01', photoScore: 80 }, today), ['few'])
eq('captions by count', photoFlags({ count: 40, noCaption: 5, analyzedAt: '2026-09-01', photoScore: 80 }, today), ['captions'])
eq('captions by share', photoFlags({ count: 20, noCaption: 6, analyzedAt: '2026-09-01', photoScore: 80 }, today), ['captions'])
eq('few photos AND captions both flagged', photoFlags({ count: 10, noCaption: 3, analyzedAt: '2026-09-01', photoScore: 80 }, today), ['few', 'captions'])
eq('never analyzed', photoFlags({ count: 20, noCaption: 0, analyzedAt: null, photoScore: null }, today), ['unanalyzed'])
eq('stale analysis', photoFlags({ count: 20, noCaption: 0, analyzedAt: '2026-01-01', photoScore: 70 }, today), ['stale-analysis'])
eq('no photos: nothing to caption or analyze, just few', photoFlags({ count: 0, noCaption: 0, analyzedAt: null, photoScore: null }, today), ['few'])

// ── tiles ──
const rows = [
  row(),
  row({ id: 'l2', name: 'Eden 2204 - Suite', building: 'Eden', market: 'Broward', channels: { ...live, airbnb2: cell('suspended', { approval: 'suspended', since: '2026-10-12T00:00:00Z' }) }, verdict: 'suspended' }),
  row({ id: 'l3', name: 'Arya 1705/2 - Studio', building: 'Arya', channels: { ...live, bookingCom: cell('missing') }, verdict: 'missing', reviews: { avg: 4.2, count: 12, owed: 2, owedLow: 1, low30: 1, last: '2026-10-24' } }),
  row({ id: 'l4', name: 'Botanica 1106', building: 'Botanica', active: false, guestyStatus: 'inactive' }),
  row({ id: 'l5', name: 'Pelican 3 - Studio', building: 'Pelican', lastOptimized: null, score: 48, photos: { count: 8, noCaption: 6, analyzedAt: null, photoScore: null } }),
  row({ id: 'l6', name: 'Elser 4418 - 3BR', building: 'Elser', blocked: { nights: 12, reason: 'Maintenance', openEnded: false, from: '2026-10-20', linked: false } }),
  row({ id: 'l7', name: 'Capri 115', building: 'Capri', blocked: { nights: 3, reason: 'Blocked by another listing', openEnded: false, from: '2026-10-25', linked: true } }),
]
const t = tileCounts(rows, today)
eq('all', t.all, 7)
eq('live everywhere counts only active rows with no major problem', t.liveAll, 4)
eq('not for sale', t.notForSale, 1)
eq('not connected', t.notConnected, 1)
eq('offline in Guesty', t.offline, 1)
eq('reply owed', t.replyOwed, 1)
eq('low reviews', t.lowReviews, 1)
eq('never optimized', t.neverOptimized, 1)
eq('optimize again (stale or low) excludes never', t.staleOptimized, 0)
eq('captions missing', t.captions, 1)
eq('photos to analyze', t.unanalyzed, 1)
eq('blocked now ignores sibling auto-blocks', t.blocked, 1)
// A tile's count is its filter — the same function both ways.
for (const k of Object.keys(t)) eq('tile ' + k + ' count = filtered rows', rows.filter(r => rowInTile(r, k, today)).length, t[k])

// ── channel strip ──
const cc = channelCounts(rows, ['airbnb2', 'bookingCom'])
eq('airbnb strip', { live: cc[0].live, suspended: cc[0].suspended }, { live: 5, suspended: 1 })
eq('booking strip', { live: cc[1].live, missing: cc[1].missing }, { live: 5, missing: 1 })

// ── do now ──
const w = worklist(rows, today)
eq('worst first', w.slice(0, 2).map(x => x.kind + ':' + x.listingId), ['channel:l2', 'reply:l3'])
eq('suspended line says since and the approval', w[0].why.indexOf('since 2026-10-12') >= 0 && w[0].why.indexOf('suspended') >= 0, true)
eq('suspended goes to the channels page for that listing', w[0].href, '/channels?listing=l2&problems=1')
eq('reply with a low review is high', w.find(x => x.kind === 'reply').severity, 'high')
eq('reply opens the unit reviews tab', w.find(x => x.kind === 'reply').href, '/listings/l3#reviews')
eq('missing channel is medium', w.find(x => x.kind === 'channel' && x.listingId === 'l3').severity, 'medium')
eq('long block is a line; the 3-night sibling block is not', w.filter(x => x.kind === 'blocked').map(x => x.listingId), ['l6'])
eq('never optimized + low score = one optimize line', w.filter(x => x.kind === 'optimize' && x.listingId === 'l5').length, 1)
eq('never optimized title', w.find(x => x.kind === 'optimize' && x.listingId === 'l5').title, 'Never optimized')
eq('photos line names every fault', w.find(x => x.kind === 'photos').title, 'Photos — only 8 photos, 6 without a caption, never analyzed')
eq('inactive listing has no lines', w.filter(x => x.listingId === 'l4').length, 0)
eq('healthy listing has no lines', w.filter(x => x.listingId === 'l1').length, 0)
eq('weight: suspended outranks never-optimized', rowWeight(rows[1], today) > rowWeight(rows[4], today), true)
eq('weight: inactive sinks', rowWeight(rows[3], today), -1)
eq('rules are exported for the hover text', RULES.replyWindowDays, 30)

// ── a channel missing on a quarter of the book is one line, not one per listing ──
const many = []
for (let i = 0; i < 20; i++) many.push(row({ id: 'm' + i, name: 'Unit ' + i, building: 'Big', channels: { ...live, expedia: cell(i < 12 ? 'missing' : 'live') }, verdict: i < 12 ? 'missing' : 'live' }))
many.push(row({ id: 'x1', name: 'Odd one', building: 'Big', channels: { ...live, bookingCom: cell('missing') }, verdict: 'missing' }))
const wm = worklist(many, today)
eq('expedia collapses to one portfolio line', wm.filter(x => x.kind === 'channel' && x.channel === 'expedia').length, 1)
eq('the portfolio line names the count', wm.find(x => x.channel === 'expedia').title, 'Expedia — not connected on 12 of 21 active listings')
eq('the portfolio line opens the channel on /channels', wm.find(x => x.channel === 'expedia').href, '/channels?channel=expedia&problems=1')
eq('a channel missing on one listing still gets its own line', wm.filter(x => x.kind === 'channel' && x.channel === 'bookingCom').map(x => x.listingId), ['x1'])
eq('tiles still count every missing listing', tileCounts(many, today).notConnected, 13)

console.log(`admin-desk: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

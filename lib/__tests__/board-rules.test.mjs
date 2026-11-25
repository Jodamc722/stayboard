// node lib/__tests__/board-rules.test.mjs
// TASKS & PROJECTS (Jon, 2026-11-25): the kinds, the offline listings that add and close themselves,
// links, how the list is organized, and what the briefs read.
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return n(s + '.ts', c); throw e } }"))
const R = await import('../board-rules.ts')
const { BOARD_NAME, BOARD_PATH, LANES, ADD_LANES, AUTO_LANE, LANE_ONE, LANE_HINT, laneOf, priOf, priRank, isPhotoUrl, cleanLink, linkLabel, offlineFromSnapshot, planOfflineSync, snapshotFresh, groupRows, sortOpen, boardForBrief, GROUP_BYS } = R
let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))

// The kinds he asked for, in his order, plus the one that fills itself
eq('the kinds', [...LANES], ['Tasks', 'Projects', 'Vendors', 'Future projects', 'Offline listings'])
eq('a person adds four of them', ADD_LANES, ['Tasks', 'Projects', 'Vendors', 'Future projects'])
ok('offline listings are not added by hand', !ADD_LANES.includes(AUTO_LANE))
ok('every kind has a singular and a hint', LANES.every(l => LANE_ONE[l] && LANE_HINT[l]))
eq('the name and the address', [BOARD_NAME, BOARD_PATH], ['Tasks & Projects', '/tasks'])
eq('the old lanes still read', ['Vendor follow-ups', 'Misc', 'Projects', 'Tasks', '', null, 'Future', 'Offline listings'].map(laneOf), ['Vendors', 'Tasks', 'Projects', 'Tasks', 'Tasks', 'Tasks', 'Future projects', 'Offline listings'])
eq('priority falls back to normal', [priOf('urgent'), priOf('x'), priOf(null)], ['urgent', 'normal', 'normal'])
ok('urgent sorts first', priRank('urgent') < priRank('high') && priRank('high') < priRank('normal') && priRank('normal') < priRank('low'))

// A photo or a link
ok('a file in our bucket is a photo', isPhotoUrl('https://x.supabase.co/storage/v1/object/public/board-photos/abc/1.jpg'))
ok('a page is not a photo', !isPhotoUrl('/glitches?id=9') && !isPhotoUrl('https://docs.google.com/x') && !isPhotoUrl('https://x.supabase.co/storage/v1/object/public/other/1.jpg'))
eq('a page in Lighthouse by path', cleanLink('/glitches?id=42'), { url: '/glitches?id=42', inApp: true })
eq('a pasted Lighthouse address becomes its path', cleanLink('https://lighthouse-stay.vercel.app/clean-invoices?id=f44#top'), { url: '/clean-invoices?id=f44#top', inApp: true })
eq('an outside page stays whole', cleanLink('https://docs.google.com/document/d/1'), { url: 'https://docs.google.com/document/d/1', inApp: false })
eq('no scheme gets https', cleanLink('guesty.com/listings/1'), { url: 'https://guesty.com/listings/1', inApp: false })
eq('another host named as ours', cleanLink('https://ops.example.com/plan', ['ops.example.com']), { url: '/plan', inApp: true })
for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'not a link', '', '//evil.example/x', 'file:///etc/passwd', 'localhost'])
  eq('refused: ' + JSON.stringify(bad), cleanLink(bad), null)
eq('labels for our pages', ['/glitches?id=1', '/clean-invoices?id=2', '/channels?listing=3', '/plan', '/some-new-page/x'].map(linkLabel), ['Guest issue', 'Invoice', 'Channels', 'Ops board', 'Some new page'])
eq('label for an outside page', linkLabel('https://www.homedepot.com/p/123'), 'homedepot.com')

// OFFLINE LISTINGS from the channel check
const U = (name, active = true) => ({ name, building: name.split(' ')[0], market: 'Broward', active })
const cellsFor = (id, o) => Object.fromEntries(['airbnb2', 'bookingCom', 'homeaway2', 'expedia', 'googleVacationRentals', 'hopper', 'bluegroundNestpick', 'whimstay', 'homesVillasByMarriott'].map(k => [id + ':' + k, o[k] || 'missing']))
const snap = {
  at: new Date().toISOString(),
  units: { a: U('Capri 114'), b: U('Capri 116'), c: U('Elser 2201'), d: U('Arya 1705'), e: U('Old Unit', false), f: U("! Jon's Unit"), g: U('Never Checked'), h: U('Nomad 9') },
  cells: {
    ...cellsFor('a', { airbnb2: 'delisted', bookingCom: 'live', homeaway2: 'failed' }),     // off Airbnb and Vrbo, still on Booking
    ...cellsFor('b', { airbnb2: 'live', bookingCom: 'stale' }),                             // fine: Expedia never connected is not an outage
    ...cellsFor('c', {}),                                                                   // on nothing at all
    ...cellsFor('d', { airbnb2: 'live', bookingCom: 'disconnected' }),                      // off Booking only
    ...cellsFor('e', { airbnb2: 'delisted' }),                                              // not active
    ...cellsFor('f', {}),                                                                   // a test listing
    ...cellsFor('h', { airbnb2: 'suspended', googleVacationRentals: 'live' }),              // suspended on Airbnb, alive on Google
  },
}
const off = offlineFromSnapshot(snap)
eq('which listings', off.map(o => o.unit), ['Elser 2201', 'Capri 114', 'Nomad 9', 'Arya 1705'])
eq('on no channel is urgent, off Airbnb is high, off another is normal', off.map(o => o.priority), ['urgent', 'high', 'high', 'normal'])
eq('the title names the channels and why', off[1].title, 'Capri 114: offline on Airbnb (page removed), Vrbo (sync failed)')
eq('on nothing', [off[0].title, off[0].none], ['Elser 2201: not on any channel', true])
eq('the key', off[1].ref, 'offline:a')
ok('never connected to Expedia alone is not on the board', !off.some(o => o.unit === 'Capri 116'))
ok('an inactive listing, a test listing and one the check never saw are left out', !off.some(o => ['Old Unit', "! Jon's Unit", 'Never Checked'].includes(o.unit)))
eq('no snapshot, nothing', offlineFromSnapshot(null), [])

// What changes on the board
const row = (id, ref, status = 'open', title = '') => ({ id, ref, status, title })
const p1 = planOfflineSync(off, [], 'S')
eq('first run adds them all', [p1.insert.length, p1.retitle.length, p1.close.length, p1.release.length], [4, 0, 0, 0])
const p2 = planOfflineSync(off, [row('r1', 'offline:a', 'open', off[1].title), row('r2', 'offline:c', 'open', 'Elser 2201: offline on Airbnb (suspended)'), row('r3', 'offline:d', 'done', off[3].title)], 'S')
eq('an open row stays; a row a person closed is not added again', p2.insert.map(i => i.unit), ['Nomad 9'])
eq('the title follows the channels', p2.retitle, [{ id: 'r2', title: 'Elser 2201: not on any channel' }])
const p3 = planOfflineSync(off.filter(o => o.unit !== 'Capri 114' && o.unit !== 'Arya 1705'), [row('r1', 'offline:a'), row('r3', 'offline:d', 'done'), row('r9', 'offline:zz:old', 'done')], 'S')
eq('back online: the open row closes and frees its key', p3.close, [{ id: 'r1', ref: 'offline:a:S' }])
eq('back online: a closed row frees its key, so the next outage is a new row', p3.release, [{ id: 'r3', ref: 'offline:d:S' }])
ok('a key already freed is left alone', !p3.close.concat(p3.release).some(x => x.id === 'r9'))
eq('offline again after that is a new row', planOfflineSync(off, [row('r1', 'offline:a:S', 'done')], 'T').insert.some(i => i.unit === 'Capri 114'), true)
ok('a fresh snapshot is trusted', snapshotFresh(snap))
ok('an old one, an empty one and none are not: nothing closes on a check that stopped', !snapshotFresh({ ...snap, at: new Date(Date.now() - 4 * 86400000).toISOString() }) && !snapshotFresh({ at: snap.at, cells: {}, units: {} }) && !snapshotFresh(null))

// ORGANIZE
const T = '2026-11-25'
const I = (id, o = {}) => ({ id, lane: 'Tasks', title: 'Row ' + id, done: false, priority: 'normal', due: null, property: null, assignees: [], ...o })
const rows = [
  I('1', { due: '2026-11-20', assignees: ['karla@x.com'], property: 'Capri' }),
  I('2', { due: T, priority: 'urgent', assignees: ['karla@x.com', 'jon@x.com'] }),
  I('3', { due: '2026-11-28', lane: 'Projects', property: 'Elser' }),
  I('4', { due: '2026-12-20', lane: 'Vendors', priority: 'high', assignees: ['jon@x.com'] }),
  I('5', { lane: 'Future projects' }),
  I('6', { lane: 'Offline listings', priority: 'urgent', property: 'Capri' }),
  I('7', { due: '2026-11-20', priority: 'high' }),
]
eq('one order everywhere: soonest, then most urgent', sortOpen(rows).map(r => r.id), ['7', '1', '2', '3', '4', '6', '5'])
const gd = groupRows(rows, 'due', T)
eq('by due date', gd.map(g => [g.title, g.rows.map(r => r.id).join('')]), [['Late', '71'], ['Today', '2'], ['Next 7 days', '3'], ['Later', '4'], ['No date', '65']])
ok('only late is marked', gd[0].late === true && !gd[1].late)
const gp = groupRows(rows, 'person', T, e => e.split('@')[0])
eq('by person: nobody first, then who carries most; two people, two places', gp.map(g => [g.title, g.rows.map(r => r.id).join('')]), [['No owner', '7365'], ['jon', '24'], ['karla', '12']])
eq('by property', groupRows(rows, 'property', T).map(g => [g.title, g.rows.length]), [['Capri', 2], ['Elser', 1], ['No property', 4]])
eq('by priority', groupRows(rows, 'priority', T).map(g => [g.title, g.rows.map(r => r.id).join('')]), [['Urgent', '26'], ['High', '74'], ['Normal', '135']])
eq('by kind', groupRows(rows, 'kind', T).map(g => [g.title, g.rows.length]), [['Tasks', 3], ['Projects', 1], ['Vendors', 1], ['Future projects', 1], ['Offline listings', 1]])
ok('an empty group is not shown', groupRows([I('1')], 'due', T).length === 1)
eq('the group-by buttons', GROUP_BYS.map(g => g.label), ['Due date', 'Person', 'Property', 'Priority', 'Kind'])

// THE BRIEFS: pending and delayed
const b = boardForBrief(rows.concat([I('8', { done: true, due: '2026-11-01' }), I('9', { lane: 'Future projects', due: '2026-11-01' }), I('10', { due: '2026-11-26' }), I('11', { due: '2026-11-29' }), I('12', { lane: 'Offline listings', due: '2026-11-24' })]), T)
eq('delayed: past the date, oldest first, most urgent first on a tie', b.late.map(r => r.id), ['7', '1', '12'])
eq('due that day', b.today.map(r => r.id), ['2'])
eq('the three days after', b.soon.map(r => r.id), ['10', '3'])
eq('pending is what people owe: tasks, projects, vendors', b.pending, 7)
eq('with no owner', b.noOwner, 4)
eq('offline listings are counted on their own', b.offline, 2)
ok('done rows and future projects never reach a brief', ![...b.late, ...b.today, ...b.soon].some(r => r.id === '8' || r.id === '9' || r.id === '5'))
const tomorrow = boardForBrief(rows, '2026-11-26')
eq('tomorrow\'s brief: what is due today is delayed by then', [tomorrow.late.map(r => r.id), tomorrow.today.map(r => r.id), tomorrow.soon.map(r => r.id)], [['7', '1', '2'], [], ['3']])
eq('nothing on the board', boardForBrief([], T), { late: [], today: [], soon: [], pending: 0, noOwner: 0, offline: 0 })

console.log(`board rules: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

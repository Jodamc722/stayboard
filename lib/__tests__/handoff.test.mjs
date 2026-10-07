// node lib/__tests__/handoff.test.mjs — HANDOFF ALERTS (Jon, 2026-10-07).
const H = await import('../handoff.ts')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (x ? '  ' + x : '')) } }
const now = '2026-10-07T14:00:00.000Z', T = Date.parse(now)
const me = { name: 'Roberto', email: 'roberto@x.com' }
ok('empty alert refused', H.makeAlert({}, me, 'a', now) === null)
const a = H.makeAlert({ title: 'Guest moved Arya 1404 → 1406', body: 'Arriving 4pm', audience: { kind: 'people', emails: ['Karla@x.com', 'bad'] }, fireAt: '2026-10-07T13:00:00Z', channel: 'G01' }, me, 'a1', now)
ok('past fire time = now', a.fireAt === now)
ok('people audience cleaned', JSON.stringify(a.audience) === JSON.stringify({ kind: 'people', emails: ['karla@x.com'] }))
ok('due now', H.isDue(a, T))
const later = H.makeAlert({ title: 'x', fireAt: '2026-10-07T20:00:00Z' }, me, 'a2', now)
ok('future fire time kept, not due', later.fireAt === '2026-10-07T20:00:00.000Z' && !H.isDue(later, T))
const fired = { ...a, firedAt: now, recipients: [{ email: 'karla@x.com', name: 'Karla' }, { email: 'silvia@x.com', name: 'Silvia' }], slackTs: '1.2' }
ok('banner for a recipient', H.bannerFor([fired], { email: 'karla@x.com' }).length === 1 && H.bannerFor([fired], { email: 'jon@x.com' }).length === 0)
let b = H.mark(fired, 'karla@x.com', 'Karla', 'seen', now)
ok('seen only', H.stageOf(b, 'karla@x.com') === 'seen')
b = H.mark(b, 'karla@x.com', 'Karla', 'ack', now)
ok('ack implies read and seen', H.stageOf(b, 'karla@x.com') === 'ack' && !!b.read['karla@x.com'] && !!b.seen['karla@x.com'])
ok('banner clears on ack', H.bannerFor([b], { email: 'karla@x.com' }).length === 0)
ok('pending is Silvia', JSON.stringify(H.pending(b).map(p => p.name)) === JSON.stringify(['Silvia']))
ok('nag after an hour', !H.needsNag(b, T + 30 * 60000) && H.needsNag(b, T + 61 * 60000))
ok('no nag past the cap', !H.needsNag({ ...b, nags: 3 }, T + 5 * 3600000))
const c = H.mark(b, 'silvia@x.com', 'Silvia', 'ack', now)
ok('closes when everyone confirmed', H.shouldClose(c, T + 1000))
const ev = { ...H.makeAlert({ title: 'Team heads-up' }, me, 'e1', now), firedAt: now, recipients: [] }
ok('everyone alert open for a day', !H.shouldClose(ev, T + 3600000) && H.shouldClose(ev, T + 25 * 3600000))
const pp = H.people(H.mark(b, 'jon@x.com', 'Jon', 'read', now))
ok('who saw it: ack first, then read, then not yet', JSON.stringify(pp.map(p => p.name + ':' + p.stage)) === JSON.stringify(['Karla:ack', 'Jon:read', 'Silvia:none']), JSON.stringify(pp))
ok('roles audience', H.isFor({ ...H.makeAlert({ title: 'x', audience: { kind: 'roles', roles: ['cs'] } }, me, 'r', now) }, { email: 'a@x.com', role: 'cs' }))
// QUIET (2026-10-07): Eve's alerts are information — bell only, never a pop-up, never nagged.
const q = { ...H.makeAlert({ title: 'Guest move conflict', source: 'eve', channel: 'G01' }, { name: 'Eve', email: 'eve@lighthouse' }, 'q1', now), firedAt: now, recipients: [], slackTs: '9.9' }
ok('eve alert is quiet', H.isQuiet(q) && q.quiet === true)
ok('quiet never pops up', H.bannerFor([q], { email: 'karla@x.com' }).length === 0)
ok('quiet shows as fyi until read', H.fyiFor([q], { email: 'karla@x.com' }).length === 1 && H.fyiFor([H.mark(q, 'karla@x.com', 'Karla', 'read', now)], { email: 'karla@x.com' }).length === 0)
ok('quiet never nags', !H.needsNag(q, T + 5 * 3600000))
ok('person alert is not quiet', !H.isQuiet(a))
console.log(`handoff: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

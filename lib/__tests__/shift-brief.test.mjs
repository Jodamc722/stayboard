// node lib/__tests__/shift-brief.test.mjs — THE SHIFT BRIEF (Jon, 2026-10-07).
const B = await import('../shift-brief.ts')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (x ? '  ' + x : '')) } }
const now = '2026-10-07T16:00:00.000Z'
const rob = { email: 'roberto@x.com', name: 'Roberto' }, kar = { email: 'karla@x.com', name: 'Karla' }
ok('empty refused', B.newItem({ text: '  ' }, rob, 'x', now) === null)
let a = B.newItem({ text: 'Confirm Eden 1203 clean before 4pm', unit: 'Eden 1203' }, rob, 'a', now)
ok('mine by default', a.owner === 'roberto@x.com' && a.seenByOwner && !a.from)
let p = B.newItem({ text: 'Call guest about parking', owner: 'pool' }, rob, 'p', now)
ok('to the pool', p.owner === null && B.poolOf([a, p]).length === 1)
let items = [a, p]
ok('cannot close with open items', B.openOf(items, rob.email).length === 1)
a = B.tick(a, 'Roberto', now)
ok('ticked', a.status === 'done' && a.doneBy === 'Roberto')
const passed = B.pass(B.newItem({ text: 'Lockbox code for 708' }, rob, 'q', now), { email: 'karla@x.com', name: 'Karla' }, 'Roberto', 'guest arrives 7pm', now)
ok('passed to Karla, unseen, note kept', passed.owner === 'karla@x.com' && !passed.seenByOwner && passed.from === 'Roberto' && passed.passNote === 'guest arrives 7pm')
items = [a, p, passed]
ok('Karla sees it first (fresh)', B.mineOf(items, kar.email)[0].id === 'q')
ok('Roberto now clear to close', B.openOf(items, rob.email).length === 0)
const c = B.closeoutOf(items, rob, '2026-10-07T00:00:00Z', 'quiet day', 'c1', now)
ok('close-out lists done and passed', JSON.stringify(c.done) === JSON.stringify(['Confirm Eden 1203 clean before 4pm']) && c.passed.length === 1 && c.passed[0].to === 'Karla', JSON.stringify(c))
const cl = B.claim(p, kar, now)
ok('claim from pool', cl.owner === 'karla@x.com' && cl.history.at(-1).what === 'claimed')
ok('done item drops off after 3 days', B.pruneBrief({ items: [{ ...a, doneAt: '2026-10-01T00:00:00Z' }], closeouts: [] }, Date.parse(now)).items.length === 0)
console.log(`shift-brief: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

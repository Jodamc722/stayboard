// node lib/__tests__/team-where.test.mjs
// WHERE IS EVERYONE (Jon, 2026-10-05). Pins the reasoning order: in progress → at the unit;
// last finish + next task → still there / heading on; nothing started → not started.
const W = await import('../team-where.ts')
const { whereNow, clockTag, shortUnit } = W

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }

const now = new Date('2026-10-05T19:00:00Z')   // 3:00pm ET
const T = (unit, building, status, startedAt = null, finishedAt = null) => ({ unit, building, status, startedAt, finishedAt })

ok('short unit', shortUnit('Eden 2104 - Studio') === 'Eden 2104' && shortUnit('17WEST - 403 - 3BR') === '17WEST 403')

{
  const w = whereNow([T('Eden 2104 - Studio', 'Eden', 'done', '2026-10-05T16:00:00Z', '2026-10-05T17:20:00Z'), T('Arya 1404 - 1BR', 'Arya', 'doing', '2026-10-05T18:10:00Z')], now)
  ok('in progress → at that unit', w.kind === 'at' && w.building === 'Arya' && /^At Arya 1404 · started 2:10pm$/.test(w.line), w.line)
}
{
  const w = whereNow([T('Eden 2104 - Studio', 'Eden', 'done', null, '2026-10-05T18:30:00Z'), T('Eden 2105 - Studio', 'Eden', 'todo'), T('Rustic 10 - 1BR', 'Rustic', 'todo')], now)
  ok('next in the same building → likely still there (same building preferred)', w.kind === 'still' && w.building === 'Eden' && /next Eden 2105/.test(w.line), w.line)
}
{
  const w = whereNow([T('Eden 2104 - Studio', 'Eden', 'done', null, '2026-10-05T18:30:00Z'), T('Rustic 10 - 1BR', 'Rustic', 'todo')], now)
  ok('next elsewhere → likely heading there', w.kind === 'heading' && w.building === 'Rustic' && /^Likely heading to Rustic/.test(w.line), w.line)
}
{
  const w = whereNow([T('Eden 2104 - Studio', 'Eden', 'done', null, '2026-10-05T16:30:00Z'), T('Rustic 10 - 1BR', 'Rustic', 'todo')], now)
  ok('a long gap with work left is flagged', w.tone === 'amber' && /nothing started in 2h30/.test(w.line), w.line)
}
{
  const w = whereNow([T('Eden 2104 - Studio', 'Eden', 'done', null, '2026-10-05T18:30:00Z')], now)
  ok('nothing left → last at', w.kind === 'last' && /^Last at Eden/.test(w.line) && /nothing left/.test(w.line), w.line)
}
{
  const w = whereNow([T('Eden 2104 - Studio', 'Eden', 'todo')], now, { in: '2026-10-05T17:30:00Z', out: null, open: true })
  ok('clocked in, nothing started → says so, amber after 45m', w.kind === 'none' && w.tone === 'amber' && /Clocked in 1:30pm · nothing started yet · first Eden 2104/.test(w.line), w.line)
}
{
  const w = whereNow([], now)
  ok('no tasks → nothing assigned', w.kind === 'none' && w.line === 'Nothing assigned')
}
ok('clock: open', clockTag({ in: '2026-10-05T12:30:00Z', out: null, open: true }, 480, now)?.label === 'on the clock')
ok('clock: out', /^clocked out 2:45pm$/.test(clockTag({ in: 'x', out: '2026-10-05T18:45:00Z', open: false }, 480, now)?.label || ''))
ok('clock: shift started, no punch', clockTag({ in: null, out: null, open: false }, 480, now)?.label === 'not clocked in')
ok('clock: unknown → nothing', clockTag(null, 480, now) === null)

console.log(`team-where: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

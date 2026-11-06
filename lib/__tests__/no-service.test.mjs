// node lib/__tests__/no-service.test.mjs
//
// NO-SERVICE BUILDINGS (Jon, 2026-11-06: "We do not need to do any inspections or welcome calls for
// any Botanica units. So don't draft them or auto create them."). The pure matcher every automation
// and owed-list asks — lib/no-service-match.ts has no imports, and lib/segments.ts supplies the same
// roll-up the server wrapper passes in.
const { matchNoService, mergeNoService, NO_SERVICE_DEFAULTS } = await import('../no-service-match.ts')
const { buildingOf } = await import('../segments.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
const m = (list, ...names) => matchNoService(list, names, buildingOf)
const B = NO_SERVICE_DEFAULTS.inspections

console.log('\nthe stored value')
eq('missing or junk falls back to Botanica on both lists', [mergeNoService(null), mergeNoService('x')], [NO_SERVICE_DEFAULTS, NO_SERVICE_DEFAULTS])
eq('a stored empty list is respected', mergeNoService({ inspections: [], welcomeCalls: ['Botanica'] }), { inspections: [], welcomeCalls: ['Botanica'] })
eq('trimmed and de-duplicated, case-insensitively', mergeNoService({ inspections: [' Botanica ', 'botanica', '', 'Eden'] }).inspections, ['Botanica', 'Eden'])
eq('one list missing keeps its default', mergeNoService({ inspections: ['Eden'] }).welcomeCalls, ['Botanica'])

console.log('\nmatching')
ok('Guesty nickname "Botanica 1204 -Double w/Kitchenette"', m(B, 'Botanica 1204 -Double w/Kitchenette'))
ok('"Botanica 2107 - B"', m(B, 'Botanica 2107 - B'))
ok('a bare building field "Botanica"', m(B, 'Botanica', ''))
ok('any one of several names is enough', m(B, null, 'Unit 1204', 'BOTANICA'))
ok('case-insensitive entry', m(['botanica'], 'Botanica 2107 - B'))
ok('not a neighbour', !m(B, 'Elser 906 - Studio', 'Elser'))
ok('whole word only', !m(B, 'Botanicals Suite 4'))
ok('empty list matches nothing', !m([], 'Botanica 1204'))
ok('no names matches nothing', !m(B, null, '', undefined))
ok('multi-word entries take flexible spaces', m(['Park Towers'], 'ParkTowers 1508'))
ok('roll-up: an Oasis plant name reads as Oasis', m(['Oasis'], 'Mahogany 2'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

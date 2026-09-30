// node lib/__tests__/never-assign.test.mjs
//
// THE NEVER-ASSIGN MATCHER (2026-09-30). People on the list must never be offered or assigned in
// Breezeway — and nobody else may be caught by it. Plain node, no deps: lib/never-assign-match.ts has
// no imports on purpose and node >= 22.18 strips the types, so this checks the very module the
// pickers, the recommenders and the assign endpoints run. Every name here is made up.
const M = await import('../never-assign-match.ts')
const { normNeverAssignList, isNeverAssign, filterAssignable, blockedIdsFrom, sameFullName, neverAssignMessage, normPersonName } = M

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)

console.log('\nthe stored value')
eq('empty and junk read as an empty list', [normNeverAssignList(null), normNeverAssignList('x'), normNeverAssignList({ people: 'no' })], [[], [], []])
eq('{ people: [...] } and a bare array both read', normNeverAssignList({ people: [{ name: 'Alex Sample' }] }), normNeverAssignList([{ name: 'Alex Sample' }]))
eq('strings become entries, spacing tidied', normNeverAssignList(['  Alex   Sample ']), [{ name: 'Alex Sample' }])
eq('a person id is kept as a number', normNeverAssignList([{ name: 'Alex Sample', personId: '4411' }]), [{ name: 'Alex Sample', personId: 4411 }])
eq('duplicates by name fold, keeping the id', normNeverAssignList([{ name: 'alex sample' }, { name: 'Alex Sample', personId: 7 }]), [{ name: 'alex sample', personId: 7 }])
eq('blank names without an id are dropped', normNeverAssignList([{ name: '  ' }, { personId: 0 }]), [])
ok('the list is capped', normNeverAssignList(Array.from({ length: 80 }, (_, i) => 'Person ' + String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)))).length === M.NEVER_ASSIGN_MAX)

console.log('\nthe name rule')
ok('normal form drops case, accents, punctuation', normPersonName('  Ána-María  O\'Brien ') === 'ana maria o brien')
ok('same full name, any case', sameFullName('alex SAMPLE', 'Alex Sample'))
ok('a shortened first name with the same surname', sameFullName('Alexandra Sample', 'Alex Sample'))
ok('a middle initial does not let them through', sameFullName('Alex J. Sample', 'Alex Sample'))
ok('the same surname with a different first name is somebody else', !sameFullName('Jamie Sample', 'Alex Sample'))
ok('the same first name with a different surname is somebody else', !sameFullName('Alex Other', 'Alex Sample'))
ok('a first name alone never matches a full name', !sameFullName('Alex', 'Alex Sample'))
ok('a full name never matches a first name alone', !sameFullName('Alex Sample', 'Alex'))
ok('a one-word entry matches the very same word', sameFullName('Opal', 'opal'))
ok('empty never matches', !sameFullName('', 'Alex Sample') && !sameFullName('Alex Sample', ''))

console.log('\nwho is on the list')
const list = normNeverAssignList({ people: [{ name: 'Alex Sample' }, { name: 'Pat Office', personId: 900 }] })
ok('by name', isNeverAssign('Alex Sample', list))
ok('by a Breezeway spelling of the name', isNeverAssign({ id: 5, name: 'ALEX  SAMPLE' }, list))
ok('by id, whatever the name says', isNeverAssign({ id: 900, name: 'Somebody Renamed' }, list))
ok('by a bare id', isNeverAssign(900, list))
ok('a different person is not', !isNeverAssign({ id: 6, name: 'Jamie Sample' }, list))
ok('a first name alone is not (it is resolved to an id first)', !isNeverAssign('Alex', list))
ok('nothing is on an empty list', !isNeverAssign('Alex Sample', []))

console.log('\nthe pickers and the ids')
const roster = [{ id: 1, name: 'Alex Sample' }, { id: 2, name: 'Jamie Sample' }, { id: 900, name: 'Pat Office' }, { id: 3, name: 'Robin Crew' }]
eq('filterAssignable keeps everyone else, in order', filterAssignable(roster, list).map(p => p.id), [2, 3])
eq('an empty list changes nothing', filterAssignable(roster, []).map(p => p.id), [1, 2, 900, 3])
eq('blocked ids passed in are dropped too', filterAssignable(roster, [], [3]).map(p => p.id), [1, 2, 900])
eq('blockedIdsFrom: explicit ids plus roster name matches', blockedIdsFrom(roster, list).sort((a, b) => a - b), [1, 900])

console.log('\nthe refusal')
ok('names who and where to change it', /Alex Sample is on the never-assign list/.test(neverAssignMessage(['Alex Sample'])) && /Task automation/.test(neverAssignMessage(['Alex Sample'])))
ok('plural reads right', / are on the never-assign list/.test(neverAssignMessage(['Alex Sample', 'Pat Office'])))
ok('with no name it still says why', /^That person is on the never-assign list/.test(neverAssignMessage([])))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// node lib/__tests__/owner-onboard-remind.test.mjs
import { remindState, ownerTask } from '../owner-onboard-remind.ts'
let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.error('FAIL', n, x === undefined ? '' : JSON.stringify(x)) } }
const D = 86_400_000, T0 = Date.parse('2026-11-02T15:00:00Z')
const at = d => new Date(T0 + d * D).toISOString()
const base = (over = {}) => ({ code: 'abc', custom: { ownerName: 'Maria', ownerEmail: 'maria@example.com', askHome: true, askSupplies: true, askPayout: true, gm: {}, sales: {} }, attach: {}, home: null, marks: {}, steps: [{ key: 'live', status: 'todo' }], auth: { tokens: [], sent: [], ver: 1, invitedAt: at(0) }, ...over })
const S = (r, d) => remindState(r, T0 + d * D)

let r = base()
ok('not invited → nothing', remindState(base({ auth: null }), T0 + 9 * D).plans.length === 0)
ok('day 1: start reminder planned, not due', S(r, 1).plans[0]?.kind === 'start' && !S(r, 1).plans[0].due)
ok('day 2: first start reminder due', S(r, 2).plans[0]?.due && S(r, 2).plans[0].n === 1)
r.remind = { log: [{ at: at(2), kind: 'start', owner: 'p' }] }
ok('after the 1st: 2nd waits three more days', !S(r, 4).plans[0].due && S(r, 5).plans[0].due && S(r, 5).plans[0].n === 2)
r.remind.log.push({ at: at(5), kind: 'start', owner: 'p' }, { at: at(10), kind: 'start', owner: 'p' })
ok('three sent: no more reminders', S(r, 12).plans.length === 0 && S(r, 12).escalate.length === 0)
ok('three days after the third: the team is told', S(r, 13).escalate[0]?.kind === 'start')
r.remind.log.push({ at: at(13), kind: 'escalate', about: 'start', owner: 'p' })
ok('the team is told once', S(r, 20).escalate.length === 0)

// started: the first thing still theirs
const started = base({ auth: { tokens: [], sent: [], ver: 1, invitedAt: at(0), activatedAt: at(1), lastSeenAt: at(1), pass: { salt: 's', hash: 'h' } } })
ok('in the portal with no paperwork: paperwork, whatever else is unfinished', ownerTask(started) === 'paperwork' && S(started, 4).plans[0]?.kind === 'paperwork' && S(started, 4).plans[0].due && !S(started, 3).plans[0].due)
started.auth.lastSeenAt = at(6)
ok('a visit resets the clock', !S(started, 8).plans[0].due && S(started, 9).plans[0].due)
started.remind = { log: [{ at: at(9), kind: 'paperwork', owner: 'p' }] }
started.payout = { w9: {}, ach: {}, sign: {} }
ok('paperwork in: nothing more, even with no home or supplies', ownerTask(started) === null && S(started, 30).plans.length === 0)
started.order = { status: 'sent', sentAt: at(10), lines: [], builtAt: at(10) }
ok('an unanswered order list is not chased by email', S(started, 40).plans.length === 0)
ok('paperwork not asked on the link: nothing', ownerTask(base({ custom: { ...base().custom, askPayout: false } })) === null)

// off switches
ok('paused', remindState(base({ remind: { paused: true, log: [] } }), T0 + 9 * D).on === false)
ok('archived', remindState(base({ archived: true }), T0 + 9 * D).on === false)
ok('live', remindState(base({ steps: [{ key: 'live', status: 'done' }] }), T0 + 9 * D).on === false)

// two owners: each on their own clock
const two = base({ owners: [{ id: 'ab12', name: 'John', email: 'john@example.com', phone: '', auth: { tokens: [], sent: [], ver: 1, invitedAt: at(4) } }] })
const p2 = S(two, 5).plans
ok('two owners, separate clocks', p2.length === 2 && p2.find(x => x.owner === 'p').due && !p2.find(x => x.owner === 'ab12').due)
console.log(`owner-onboard-remind: ${pass} passed, ${fail} failed`); if (fail) process.exit(1)

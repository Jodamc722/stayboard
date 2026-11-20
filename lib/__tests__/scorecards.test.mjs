// node lib/__tests__/scorecards.test.mjs
//
// SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and Leaderboard
// based on KPI"). The rules a leaderboard must keep, on the pure half (lib/scorecards-core.ts has no
// imports, and node >= 22.18 strips its types): no rate without a sample, the top of the board only in
// an email, a template is not an answer, and nobody is credited when two people fit.
const C = await import('../scorecards-core.ts')
const { rankPeople, topOfBoard, shareOrCount, median, hoursHit, replyRuns, creditFrom, nameFromEmail, notEnough, fmtMinutes, fmtWait, phrase, MIN_RATE_SAMPLE, TEAMS } = C

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)

// 1. The six teams Jon named, in the order the page draws them.
eq('teams', TEAMS.map(t => t.key), ['admin', 'ccs', 'housekeeping', 'maintenance', 'inspections', 'reviews'])

// 2. NO RATE WITHOUT A SAMPLE.
eq('share under the minimum is a count', shareOrCount(3, 4, 10), { pct: null, n: 4, text: '3 of 4' })
eq('share at the minimum is a percent', shareOrCount(9, 10, 10), { pct: 90, n: 10, text: '90%' })
eq('share of nothing', shareOrCount(0, 0, 10).text, '—')
eq('not enough wording', notEnough(3), 'not enough yet (3)')

// 3. RANKING. Best first; under the minimum is listed and never ranked; ties share a rank.
const pct = v => Math.round(v * 100) + '%'
const board = rankPeople([
  { name: 'Ana', value: 0.9, sample: 20 },
  { name: 'Bea', value: 1, sample: 3 },                 // a perfect 3 of 3 is not first place
  { name: 'Cruz', value: 0.9, sample: 12 },
  { name: 'Dee', value: 0.5, sample: 10 },
  { name: 'Eli', value: null, sample: 0, secondary: ['2 glitches closed'] },
  { name: 'Fay', value: null, sample: 0 },              // nothing to show: not listed at all
], { minSample: MIN_RATE_SAMPLE, fmt: pct })
eq('ranked names, best first, larger sample breaks the tie', board.rows.map(r => r.name), ['Ana', 'Cruz', 'Dee'])
eq('equal values share a rank', board.rows.map(r => r.rank), [1, 1, 3])
eq('kpi text', board.rows.map(r => r.kpi), ['90%', '90%', '50%'])
eq('the count is carried beside every rate', board.rows.map(r => r.count), [20, 12, 10])
eq('unranked names', board.unranked.map(r => r.name), ['Bea', 'Eli'])
eq('unranked wording', board.unranked.map(r => r.kpi), ['not enough yet (3)', '—'])
ok('unranked rows carry no rank and no value', board.unranked.every(r => r.rank === null && r.value === null))
ok('nobody is in both lists', board.rows.every(r => !board.unranked.some(u => u.name === r.name)))
// A count board (tasks completed) ranks from one event, lower-is-better boards sort the other way.
eq('count board', rankPeople([{ name: 'A', value: 2, sample: 2 }, { name: 'B', value: 14, sample: 14 }], { minSample: 1, fmt: String }).rows.map(r => r.name + ' ' + r.kpi), ['B 14', 'A 2'])
eq('ascending board', rankPeople([{ name: 'A', value: 2, sample: 5 }, { name: 'B', value: 1, sample: 5 }], { minSample: 5, order: 'asc', fmt: String }).rows.map(r => r.name), ['B', 'A'])

// 4. THE EMAILS SHOW THE TOP ONLY: ranked rows, never the unranked, nothing from a board that failed.
const lb = { ranksBy: 'x', kpiLabel: 'k', countLabel: 'c', minSample: 10, ...board }
eq('top three', topOfBoard(lb, 3).map(r => r.name), ['Ana', 'Cruz', 'Dee'])
eq('top one', topOfBoard(lb, 1).map(r => r.name), ['Ana'])
ok('top never reaches into the unranked', topOfBoard(lb, 99).every(r => r.rank !== null) && topOfBoard(lb, 99).length === 3)
eq('a degraded board names nobody', topOfBoard({ ...lb, degraded: 'read failed' }, 3), [])
eq('no board', topOfBoard(null, 3), [])

// 5. HOURS HIT PER CLEAN: at or under the expected time is within; untimed cleans are not counted.
// A two-minute "clean" is a timer started at the door and an eleven-hour one was never stopped: neither is timed.
const hh = hoursHit([{ minutes: 90, expected: 120 }, { minutes: 120, expected: 120 }, { minutes: 150, expected: 120 }, { minutes: 0, expected: 120 }, { minutes: 60, expected: 0 }, { minutes: 2, expected: 120 }, { minutes: 660, expected: 120 }])
eq('hours hit', [hh.timed, hh.within, hh.avgActual, hh.avgExpected], [3, 2, 120, 120])
eq('a 2-minute clean never counts as within the expected time', hoursHit([{ minutes: 2, expected: 120 }]).timed, 0)
eq('no timed cleans', hoursHit([]), { timed: 0, within: 0, avgActual: null, avgExpected: null })

// 6. GUEST REPLIES: a template answers nobody, a follow-up does not restart the clock.
const isPerson = n => !/^(hook|auto pilot)$/i.test(n)
const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 19, h, m)).toISOString()
const runs = replyRuns([
  { conversation_id: 'a', sender: 'guest', sent_at: at(14, 0) },
  { conversation_id: 'a', sender: 'host', sender_name: 'hook', is_automated: false, sent_at: at(14, 1) },   // machine author
  { conversation_id: 'a', sender: 'guest', sent_at: at(14, 20) },                                           // still waiting
  { conversation_id: 'a', sender: 'host', sender_name: 'Template', is_automated: true, sent_at: at(14, 25) },
  { conversation_id: 'a', sender: 'system', module: 'log', sent_at: at(14, 26) },
  { conversation_id: 'a', sender: 'host', sender_name: 'Amna Ijaz', is_automated: false, sent_at: at(14, 30) },
  { conversation_id: 'a', sender: 'host', sender_name: 'Amna Ijaz', is_automated: false, sent_at: at(14, 31) }, // nothing open: not a reply
  { conversation_id: 'b', sender: 'guest', sent_at: at(15, 0) },                                            // never answered
  { conversation_id: 'c', sender: 'host', sender_name: 'Hassan Faiz', sent_at: at(9, 0) },                  // proactive: no question
  { conversation_id: 'c', sender: 'host', module: 'note', sender_name: 'Hassan Faiz', sent_at: at(9, 5) },
], { isPerson })
const a = runs.find(r => r.conversation_id === 'a')
eq('one run per waiting guest', runs.filter(r => r.conversation_id === 'a').length, 1)
eq('the clock starts at the first unanswered message', a.askedAt, at(14, 0))
eq('a person closes it', [a.responder, a.ms], ['Amna Ijaz', 30 * 60000])
eq('never answered stays open', runs.find(r => r.conversation_id === 'b').answeredAt, null)
ok('a proactive message is not a reply', !runs.some(r => r.conversation_id === 'c'))
// A guest message days after an unanswered one starts a fresh run (the 72-hour horizon).
const far = replyRuns([
  { conversation_id: 'd', sender: 'guest', sent_at: '2026-11-10T15:00:00Z' },
  { conversation_id: 'd', sender: 'guest', sent_at: '2026-11-19T15:00:00Z' },
  { conversation_id: 'd', sender: 'host', sender_name: 'Amna Ijaz', sent_at: '2026-11-19T15:10:00Z' },
], { isPerson })
eq('a stale run is closed, the new one is timed from its own message', far.map(r => r.ms), [null, 10 * 60000])

// 7. WHO DID IT: the one person active just before the outcome, or nobody.
const stamps = [{ at: 1000, email: 'a@x' }, { at: 2000, email: 'a@x' }, { at: 9000, email: 'b@x' }]
eq('one person in the window', creditFrom(stamps, 2500, 2000, 100), 'a@x')
eq('two people in the window is nobody', creditFrom(stamps, 9000, 8000, 100), null)
eq('nobody in the window', creditFrom(stamps, 5000, 1000, 100), null)
eq('after the outcome, inside the grace', creditFrom(stamps, 8950, 100, 100), 'b@x')
eq('no stamps', creditFrom([], 1000, 1000, 1000), null)

// 8. Small formatters.
eq('name from an email', [nameFromEmail('suleman.afzal@x.com'), nameFromEmail('bernadette@x.com'), nameFromEmail('rhyosenis575@x.com')], ['Suleman Afzal', 'Bernadette', 'Rhyosenis'])
eq('minutes', [fmtMinutes(45), fmtMinutes(125), fmtMinutes(120), fmtMinutes(null)], ['45m', '2h 5m', '2h', '—'])
eq('waits', [fmtWait(30000), fmtWait(5 * 60000), fmtWait(90 * 60000), fmtWait(null)], ['30s', '5m', '1.5h', '—'])
eq('phrases drop a zero', [phrase(0, 'listing optimised'), phrase(1, 'listing optimised', 'listings optimised'), phrase(12, 'listing optimised', 'listings optimised')], [null, '1 listing optimised', '12 listings optimised'])
eq('median', [median([3, 1, 2]), median([1, 2, 3, 4]), median([])], [2, 2.5, null])

console.log(`scorecards: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

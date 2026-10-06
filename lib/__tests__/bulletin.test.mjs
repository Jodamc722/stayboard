// node lib/__tests__/bulletin.test.mjs — THE BULLETIN BOARD rules (Jon, 2026-10-06).
const B = await import('../bulletin.ts')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (x ? '  ' + x : '')) } }
const today = '2026-10-06'
const me = { name: 'Jon', email: 'jon@x.com' }
const mk = (input, id, at = '2026-10-06T12:00:00Z') => B.makePost(input, me, today, id, at)

ok('empty post refused', mk({ kind: 'announcement' }, 'a') === null)
const q1 = mk({ kind: 'quote', body: 'Hospitality is a feeling', title: 'Danny' }, 'q1', '2026-10-06T10:00:00Z')
const q2 = mk({ kind: 'quote', body: 'Do the next right thing' }, 'q2', '2026-10-06T11:00:00Z')
ok('quote up today only', q1.expires === today)
const e = mk({ kind: 'eotm', title: 'Karla', body: 'Ran the field all month' }, 'e1', '2026-10-01T12:00:00Z')
ok('eotm up until month end', e.expires === '2026-10-31')
const r = mk({ kind: 'reminder', title: 'Pool permit renewal', due: '2026-10-05', owner: 'Jon' }, 'r1')
ok('reminder never expires on its own', r.expires === null && r.due === '2026-10-05')
ok('reminder overdue', B.dueState(r, today) === 'overdue')
const r2 = mk({ kind: 'reminder', title: 'Send owner decks', due: '2026-10-08' }, 'r2')
ok('reminder soon', B.dueState(r2, today) === 'soon')
const old = { ...mk({ kind: 'announcement', title: 'Old news' }, 'o1', '2026-09-20T12:00:00Z'), expires: '2026-09-26' }
const pin = { ...mk({ kind: 'announcement', title: 'Pinned' }, 'p1', '2026-10-02T12:00:00Z'), pinned: true }
const rev = mk({ kind: 'review', review: { id: '9', unit: 'Eden 2104', guest: 'Ana', stars: 5, channel: 'airbnb', date: '2026-10-04', text: 'Spotless and so easy' } }, 'v1', '2026-10-06T13:00:00Z')
ok('review takes the unit as title', rev.title === 'Eden 2104' && rev.expires === '2026-10-19')
const posts = [q1, q2, e, r, r2, old, pin, rev]
const board = B.boardPosts(posts, today).map(p => p.id)
ok('board: pinned, eotm, newest quote, then newest; expired and reminders out; one quote', JSON.stringify(board) === JSON.stringify(['p1', 'e1', 'q2', 'v1']), JSON.stringify(board))
ok('have to: overdue first', JSON.stringify(B.haveToPosts(posts, today).map(p => p.id)) === JSON.stringify(['r1', 'r2']))
const doneOld = { ...r, doneAt: '2026-10-04T12:00:00Z' }, doneNew = { ...r2, doneAt: '2026-10-05T20:00:00Z' }
ok('a done reminder stays a day, then goes', !B.isLive(doneOld, today) && B.isLive(doneNew, today))
let x = B.toggleReaction(e, '👏', 'a@x'); x = B.toggleReaction(x, '👏', 'b@x'); x = B.toggleReaction(x, '👏', 'a@x')
ok('reactions toggle per person', JSON.stringify(x.reactions) === JSON.stringify({ '👏': ['b@x'] }))
ok('unknown emoji ignored', B.toggleReaction(e, '💩', 'a@x') === e)
ok('edit pins', B.editPost(e, { pinned: true }).pinned === true)
ok('prune drops month-old expired', B.prune([old, { ...old, id: 'z', expires: '2026-08-01' }], today).length === 1)
ok('end of month', B.endOfMonth('2026-02-10') === '2026-02-28')
ok('month-day parses', B.monthDay('1990-03-07') === '03-07' && B.monthDay('3/7') === '03-07' && B.monthDay('12-31') === '12-31' && B.monthDay('13-01') === null && B.monthDay('') === null)
{
  const up = B.upcomingBirthdays({ Karla: '10-06', Ana: '10-09', Luis: '11-01', Leap: '02-29' }, '2026-10-06')
  ok('birthdays today and this week, soonest first', JSON.stringify(up.map(x => x.name + x.inDays)) === JSON.stringify(['Karla0', 'Ana3']), JSON.stringify(up))
  ok('feb 29 celebrated feb 28 off leap years', B.upcomingBirthdays({ Leap: '02-29' }, '2027-02-28', 0).length === 1)
}
ok('fallback quote is stable for a day', B.fallbackQuote('2026-10-06').q === B.fallbackQuote('2026-10-06').q && !!B.fallbackQuote('2026-01-01').a)
console.log(`bulletin: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

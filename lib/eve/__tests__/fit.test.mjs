// node lib/eve/__tests__/fit.test.mjs — lib/eve/fit.ts keeps a tool result under the budget
// without cutting JSON in half, and says what it shortened (2026-09-28 audit, F3).
const { fitResult, TOOL_RESULT_CHARS } = await import('../fit.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }

const row = (i) => ({ unit: 'Oasis ' + (1100 + i), building: 'Oasis', guest: 'Guest Number ' + i, checkOutTime: '11:00 AM', status: 'TURNING', sameDayTurn: i % 2 === 0, nextGuest: '4:00 PM today', clean: { status: 'open', assignees: ['Ana', 'Luis'], label: 'Departure clean' } })
const big = {
  date: '2026-09-28', counts: { departures: 60, arrivals: 60 },
  departures: Array.from({ length: 60 }, (_, i) => row(i)),
  arrivals: Array.from({ length: 30 }, (_, i) => ({ unit: 'Eden ' + i, guest: 'G' + i, checkInTime: '4:00 PM' })),
  glitches: [{ unit: 'Eden 2', overview: 'AC' }],
  note: 'Counts come from the same builder the /plan board renders.',
}
const out = fitResult(big)
const s = JSON.stringify(out)
ok('fits the budget', s.length <= TOOL_RESULT_CHARS, `${s.length}`)
ok('still valid JSON with the note', JSON.parse(s).note === big.note)
ok('says which list was cut', typeof out._cut?.departures === 'string' && /^60→\d+$/.test(out._cut.departures), JSON.stringify(out._cut))
ok('the small lists survive whole', out.glitches.length === 1)
ok('the first rows are kept (worst-first order is preserved)', out.departures[0].unit === 'Oasis 1100')

const small = { a: [1, 2, 3], b: 'x' }
ok('a result that fits comes back as it was', fitResult(small) === small)

const text = { note: 'x'.repeat(20000) }
const t = fitResult(text)
ok('one huge string is shortened, not torn', JSON.stringify(t).length <= TOOL_RESULT_CHARS && t._cut && t._cut._text)

const arr = Array.from({ length: 500 }, (_, i) => ({ i, pad: 'y'.repeat(50) }))
const a = fitResult(arr)
ok('a bare list is wrapped and shortened', Array.isArray(a.items) && a._cut.items && JSON.stringify(a).length <= TOOL_RESULT_CHARS)

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

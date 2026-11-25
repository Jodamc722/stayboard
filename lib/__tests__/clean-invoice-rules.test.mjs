// node lib/__tests__/clean-invoice-rules.test.mjs
// VENDOR INVOICES, TWO MODELS (Jon, 2026-11-25): per clean against Breezeway and the checkouts (a clean
// can be moved), and by the hour against Homebase. The numbers below are off the real invoices of
// Nov 21: Opal #337 and Atlantic #195.
const R = await import('../clean-invoice-rules.ts')
const { VERDICT_LABEL, FLAGGED, OK, isOk, isFlagged, vendorWords, isVendorName, judgeDatedLine, workedInPeriod, wholeWeeks, billedByPerson, judgeHours, expectedTotal, judgeAmount, agencyFor } = R
let pass = 0, fail = 0
const ok = (name, v) => { if (v) pass++; else { fail++; console.log('  FAIL  ' + name) } }
const eq = (name, got, want) => ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))

// The lists agree with each other
ok('every verdict has a label', [...OK, ...FLAGGED, 'hours_under', 'unchecked'].every(v => !!VERDICT_LABEL[v]))
ok('nothing is both fine and flagged', OK.every(v => !isFlagged(v)) && FLAGGED.every(v => !isOk(v)))
ok('billing fewer hours than worked is not a flag', !isFlagged('hours_under') && !isOk('hours_under'))
ok('a line that could not be checked is neither fine nor flagged', !isFlagged('unchecked') && !isOk('unchecked'))
ok('a moved clean is fine; someone else cleaning it is a flag', isOk('moved') && isFlagged('other_cleaner'))

// Who the vendor is
eq('Opal', vendorWords('Opal Works, LLC'), ['opal'])
eq('Pro Bowl', vendorWords('Pro Bowl Cleaning Services'), ['pro', 'bowl'])
eq('Atlantic', vendorWords('Atlantic Shores Services'), ['atlantic', 'shores'])
ok('Breezeway sends a company as first and last name', isVendorName('Opal Works Opal Works', ['opal']))
ok('a cleaner is not the vendor', !isVendorName('Maribel Alvarez', ['opal']) && !isVendorName(null, ['opal']))
ok('both words for a two-word vendor', isVendorName('Pro Bowl Cleaning', ['pro', 'bowl']) && !isVendorName('Prospero Diaz', ['pro', 'bowl']))
ok('no words, no match', !isVendorName('Anyone', []))

// PER CLEAN: one dated line
const T = (id, day, o = {}) => ({ id, day, scheduled: day, done: true, status: 'finished', by: 'Opal Works', ...o })
eq('a clean finished that day', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-16')]).verdict, 'match')
eq('scheduled that day, finished after midnight', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-17', { scheduled: '2026-11-16' })]).verdict, 'match')
// THE MOVED CLEAN: billed on the checkout day, cleaned two days later.
const moved = judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-18')], ['2026-11-16'], ['2026-11-12', '2026-11-20'])
eq('moved after the checkout', [moved.verdict, moved.taskId], ['moved', 'a'])
ok('and it says both days', moved.why.includes('Nov 16') && moved.why.includes('Nov 18') && moved.why.includes('Opal Works'))
eq('moved by one day is moved, not a wrong date', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-17')], ['2026-11-16'], []).verdict, 'moved')
eq('billed on the day it was actually cleaned is a plain match', judgeDatedLine('2026-11-18', 'Capri 111', [T('a', '2026-11-18')], ['2026-11-16'], []).verdict, 'match')
eq('a clean after the next guest arrived is that guest\'s clean, not this one', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-21')], ['2026-11-16', '2026-11-21'], ['2026-11-17']).verdict, 'no_clean')
eq('a clean on the next arrival day still counts', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-19')], ['2026-11-16'], ['2026-11-19']).verdict, 'moved')
eq('more than a week later is not the same clean', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-25')], ['2026-11-16'], []).verdict, 'no_clean')
eq('no checkout that day: a clean two days later is not a move', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-18')], [], []).verdict, 'no_clean')
eq('no checkout, one day off: a wrong date', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-15')], [], []).verdict, 'date_off')
eq('the earliest clean after the checkout is the one', judgeDatedLine('2026-11-16', 'Capri 111', [T('b', '2026-11-20'), T('a', '2026-11-18')], ['2026-11-16'], []).taskId, 'a')
eq('moved and still not finished', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-18', { done: false, status: 'in progress' })], ['2026-11-16'], []).verdict, 'not_done')
eq('scheduled that day and never finished', judgeDatedLine('2026-11-16', 'Capri 111', [T('a', '2026-11-16', { done: false, status: 'cancelled' })]).verdict, 'not_done')
const none = judgeDatedLine('2026-11-16', 'Capri 111', [], ['2026-11-16'], [])
ok('a checkout with no clean says so', none.verdict === 'no_clean' && none.why.includes('There was a checkout') && none.why.includes('Nov 23'))
ok('no checkout and no clean says so', judgeDatedLine('2026-11-16', 'Capri 111', []).why.startsWith('No checkout and no housekeeping task'))
// One clean cannot answer two lines: the caller drops a used clean from the candidates.
eq('the same clean billed twice has nothing left', judgeDatedLine('2026-11-16', 'Capri 111', [], ['2026-11-16'], []).verdict, 'no_clean')

// HOURS: what was worked
const week = (name, hours, start = '2026-11-15') => hours.map((h, i) => ({ name, date: new Date(Date.parse(start + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10), hours: h }))
eq('46.1 hours in a week is 40 and 6.1', workedInPeriod(week('Dayrene', [8, 8.1, 8, 8, 7, 7]), '2026-11-15', '2026-11-21'), { total: 46.1, reg: 40, ot: 6.1, days: 6 })
eq('under 40 has no overtime', workedInPeriod(week('Shaany', [8, 8, 8, 8, 6.98]), '2026-11-15', '2026-11-21'), { total: 38.98, reg: 38.98, ot: 0, days: 5 })
// Two weeks, each with its own 40: Atlantic bills two weeks on one invoice.
const two = week('Alejandro', [8, 8, 8, 8, 8, 3.6], '2026-11-15').concat(week('Alejandro', [8, 8, 8, 7], '2026-11-08'))
eq('two weeks: overtime week by week', workedInPeriod(two, '2026-11-08', '2026-11-21'), { total: 74.6, reg: 71, ot: 3.6, days: 10 })
eq('punches outside the period are left out', workedInPeriod(week('X', [8, 8], '2026-11-14'), '2026-11-15', '2026-11-21').total, 8)
eq('nothing punched', workedInPeriod([], '2026-11-15', '2026-11-21'), { total: 0, reg: 0, ot: 0, days: 0 })
ok('one week and two weeks are whole weeks; ten days is not', wholeWeeks('2026-11-15', '2026-11-21') && wholeWeeks('2026-11-08', '2026-11-21') && !wholeWeeks('2026-11-12', '2026-11-21'))

// HOURS: what was billed
const opal = [
  { name: 'Dayrene Mayari', role: 'Housekeeper', market: 'Miami', regHours: 40, otHours: 6.1, baseRate: 18 },
  { name: 'Jenny Solano', role: 'Housekeeper', market: 'Miami', regHours: 31.68, otHours: 0, baseRate: 18 },
  { name: 'Maria F. Rodriguez', role: 'Housekeeper', market: 'Miami', regHours: 32.99, otHours: 0, baseRate: 18 },
  { name: 'Yaribel Ruiz', role: 'Housekeeper', market: 'Miami', regHours: 40, otHours: 2.95, baseRate: 18 },
  { name: 'Donovan Jervis', role: 'Housekeeper', market: 'Broward', regHours: 24.82, otHours: 0, baseRate: 18 },
  { name: 'Donovan Jervis', role: 'Maintenance', market: 'Broward', regHours: 8.58, otHours: 0, baseRate: 18 },
  { name: 'Diana Romero', role: 'Housekeeper', market: 'Palm Beach', regHours: 40, otHours: 2.82, baseRate: 18 },
]
const people = billedByPerson(opal)
eq('one entry a person', people.length, 6)
const don = people.find(p => p.name === 'Donovan Jervis')
eq('the same person under two sections is added up', [don.reg, don.ot, don.where], [33.4, 0, 'Housekeeper, Broward · Maintenance, Broward'])
eq('hours billed in all', Math.round(people.reduce((a, p) => a + p.reg + p.ot, 0) * 100) / 100, 229.94)
eq('no amount printed stays unknown', don.amount, null)
eq('amounts printed are added', billedByPerson([{ name: 'A B', regHours: 1, otHours: 0, amount: 10 }, { name: 'a  b', regHours: 1, otHours: 0, amount: 5.5 }])[0].amount, 15.5)

// HOURS: one person against Homebase
const W = (total, ot = Math.max(0, total - 40)) => ({ total, reg: Math.round((total - ot) * 100) / 100, ot, days: 6 })
const opts = { known: true, weekly: true, period: 'Nov 15 to Nov 21', rate: 23.05, otRate: 32.05 }
eq('to the hundredth', judgeHours({ reg: 40, ot: 6.1 }, W(46.1), opts).verdict, 'hours_match')
eq('a few minutes of rounding is a match', judgeHours({ reg: 38.98, ot: 0 }, W(39.04, 0), opts).verdict, 'hours_match')
const over = judgeHours({ reg: 40, ot: 8.1 }, W(46.1), opts)
eq('two hours more than worked', [over.verdict, over.risk], ['hours_over', 46.1])
ok('and it says both numbers', over.why.includes('48.10h') && over.why.includes('46.10h') && over.why.includes('2.00h more'))
eq('fewer hours than worked is not a flag', judgeHours({ reg: 30, ot: 0 }, W(38.98, 0), opts).verdict, 'hours_under')
const ot = judgeHours({ reg: 36, ot: 10.1 }, W(46.1), opts)
eq('the total matches but more of it is billed as overtime', [ot.verdict, ot.risk], ['ot_off', 36])
eq('overtime is not compared on a period that is not whole weeks', judgeHours({ reg: 36, ot: 10.1 }, W(46.1), { ...opts, weekly: false }).verdict, 'hours_match')
eq('less overtime billed than worked is fine', judgeHours({ reg: 42, ot: 4.1 }, W(46.1), opts).verdict, 'hours_match')
eq('on our roster with no punches', judgeHours({ reg: 40, ot: 0 }, null, opts).verdict, 'no_punches')
eq('on our roster with zero hours', judgeHours({ reg: 40, ot: 0 }, { total: 0, reg: 0, ot: 0, days: 0 }, opts).verdict, 'no_punches')
const ghost = judgeHours({ reg: 40, ot: 0 }, null, { ...opts, known: false })
eq('nobody by that name', [ghost.verdict, ghost.risk], ['unknown_person', 922])
eq('no rate, no money at stake', judgeHours({ reg: 40, ot: 8.1 }, W(46.1), { known: true, weekly: true, period: 'x' }).risk, null)

// HOURS: the money. Opal #337 billed $5,434.56; its own sheet says $18.00 base, time and a half, $5.05 an hour on all hours.
eq('what the Opal hours come to on the stated terms', expectedTotal(people, 5.05), 5406.95)
const amt = judgeAmount(5434.56, people, 5.05, 'the fee printed on the invoice')
eq('Opal #337 is over by $27.61', [amt.verdict, amt.risk], ['amount_off', 27.61])
ok('and it says why', amt.why.includes('$5,434.56') && amt.why.includes('$5,406.95') && amt.why.includes('$27.61 over') && amt.why.includes('time and a half on the 11.87h of overtime'))
eq('billed to the dollar', judgeAmount(5406.95, people, 5.05, 'x').verdict, 'hours_match')
eq('billed under is not a flag', judgeAmount(5300, people, 5.05, 'x').verdict, 'hours_match')
eq('no fee known, no check', judgeAmount(5434.56, people, 0, 'x'), null)
eq('no total, no check', judgeAmount(null, people, 5.05, 'x'), null)
eq('a missing pay rate, no check', judgeAmount(100, billedByPerson([{ name: 'A B', regHours: 5, otHours: 0 }]), 2, 'x'), null)
// Atlantic #195, one person: 70.96 regular at $19, 3.60 overtime, fee $2. Billed $1,603.56 (fee at $3 on overtime).
const alej = billedByPerson([{ name: 'Alejandro Pastran', regHours: 70.96, otHours: 3.6, baseRate: 19, otRate: 28.5, amount: 1603.56 }])
eq('Atlantic at a flat $2', expectedTotal(alej, 2), 1599.96)
const a2 = judgeAmount(1603.56, alej, 2, 'the fee set for Atlantic in Lighthouse')
ok('the fee at time and a half on overtime is caught and named', a2.verdict === 'amount_off' && a2.risk === 3.6 && a2.why.includes('time and a half on the 3.60h of overtime'))

// Which agency
const ags = [{ key: 'opal', label: 'Opal' }, { key: 'citybest', label: 'CityBest' }, { key: 'atlantic', label: 'Atlantic' }]
eq('Opal Works, LLC', agencyFor('Opal Works, LLC', ags)?.key, 'opal')
eq('Atlantic Shores Services', agencyFor('Atlantic Shores Services', ags)?.key, 'atlantic')
eq('City Best', agencyFor('City Best Staffing Inc.', ags)?.key, 'citybest')
eq('a per-clean vendor is no agency', agencyFor('Pro Bowl Cleaning Services', ags), null)
eq('no vendor', agencyFor('', ags), null)

console.log(`clean-invoice rules: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

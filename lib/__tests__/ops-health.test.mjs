// node lib/__tests__/ops-health.test.mjs — the Today board's Ops Health number (lib/ops-health.ts).
const { opsHealth } = await import('../ops-health.ts')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const base = (over = {}) => ({
  nowMin: 11 * 60,
  cleans: { total: 12, done: 4, late: 0, atRisk: 0, nobody: 0, sameDay: 5, sameDayDone: 1, sameDayTrouble: 0 },
  glitches: { open: 0, overdue: 0, noTask: 0, awaitingApproval: 0 },
  maint: { open: 6, urgentOpen: 0, nobody: 0 },
  insp: { needed: 4, done: 1, nobody: 0, missingBig: 0 },
  calls: { todayOwed: 2, todayDone: 6, recoveryOwed: 0, recoveryDone: 1, loaded: true },
  notices: { toSend: 3, late: 0 },
  reviews: { waiting: 2, lowWaiting: 0 },
  checklist: { total: 15, done: 9, late: 0 },
  claims: { open: 2, dueSoon: 0, review: 1 },
  unpaid: { open: 0, today: 0 },
  ...over,
})
console.log('\nops health')
const quiet = opsHealth(base())
ok('a normal morning is Smooth', quiet.band === 'smooth', String(quiet.score))
ok('six dimensions, weights sum 100', quiet.dims.length === 6 && quiet.dims.reduce((a, d) => a + d.weight, 0) === 100)
const g = opsHealth(base({ glitches: { open: 3, overdue: 2, noTask: 1, awaitingApproval: 0 } }))
ok('two overdue glitches pull Guest issues under 50', g.dims.find(d => d.key === 'glitches').score < 50, String(g.dims.find(d => d.key === 'glitches').score))
ok('…and the headline names them', /glitches overdue/.test(g.headline), g.headline)
const r = opsHealth(base({ nowMin: 16 * 60 + 30, cleans: { total: 12, done: 9, late: 3, atRisk: 0, nobody: 0, sameDay: 5, sameDayDone: 2, sameDayTrouble: 3 } }))
ok('three of five same-day turns missed 4pm = Rooms well under 70', r.dims.find(d => d.key === 'rooms').score < 70, String(r.dims.find(d => d.key === 'rooms').score))
ok('…said as missed, after 4pm', /missed 4pm/.test(r.dims.find(d => d.key === 'rooms').why), r.dims.find(d => d.key === 'rooms').why)
const c = opsHealth(base({ nowMin: 17 * 60, calls: { todayOwed: 5, todayDone: 1, recoveryOwed: 0, recoveryDone: 0, loaded: true } }))
ok('calls still owed at 5pm sting harder than at 11am', c.dims.find(d => d.key === 'guests').score < opsHealth(base({ calls: { todayOwed: 5, todayDone: 1, recoveryOwed: 0, recoveryDone: 0, loaded: true } })).dims.find(d => d.key === 'guests').score)
const bad = opsHealth(base({ glitches: { open: 4, overdue: 3, noTask: 2, awaitingApproval: 0 }, cleans: { total: 12, done: 2, late: 4, atRisk: 1, nobody: 2, sameDay: 6, sameDayDone: 0, sameDayTrouble: 5 }, maint: { open: 8, urgentOpen: 3, nobody: 2 } }))
ok('a bad day is Behind', bad.band === 'behind', String(bad.score))
ok('scores never leave 0..100', bad.dims.every(d => d.score >= 0 && d.score <= 100) && bad.score >= 0)
const nocalls = opsHealth(base({ calls: { todayOwed: 0, todayDone: 0, recoveryOwed: 0, recoveryDone: 0, loaded: false }, reviews: { waiting: 0, lowWaiting: 0 } }))
ok('calls not loaded is not a penalty', nocalls.dims.find(d => d.key === 'guests').score === 100)
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

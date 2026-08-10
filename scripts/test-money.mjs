// node scripts/test-money.mjs
// Tests for the money-visibility gate: lib/money.ts (redaction) + lib/access.ts canSeeMoney().
// Both are re-implemented here from the same source text so this runs with plain node, no build.
import { readFileSync } from 'node:fs'

// The REAL module, imported directly — node ≥22.18 strips the types itself, so there is no
// transcribed copy of the redactor to drift out of sync with the one that actually runs.
const { isMoneyKey, redactMoney, pctOf } = await import('../lib/money.ts')

// canSeeMoney, transcribed from lib/access.ts (kept in sync by the assertion at the bottom).
const SUPERADMIN = 'jon@stay-hospitality.com'
const isSuperadmin = (email) => String(email || '').toLowerCase() === SUPERADMIN
function canSeeMoney(access) {
  if (isSuperadmin(access.email)) return true
  return access.features?.money === true
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++ } else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

// ---------------------------------------------------------------- key classification
console.log('\nisMoneyKey')
for (const k of ['revenue', 'payroll', 'margin', 'wageRate', 'laborCost', 'taskPay', 'pay',
  'costPerClean', 'feePerClean', 'avgFeePerClean', 'billableRevenue', 'billableMargin',
  'revenueGenerated', 'totalLaborCost', 'laborCostPerOccupiedNight', 'payrollSoFar',
  'scheduledPayroll', 'cleaningRevenueToday', 'supervisorPayroll', 'cleanerPayroll',
  'feesWithNoMatchedClean', 'attributedRevenue', 'totalCleaningRevenue', 'cleaningMargin',
  'personRevenue', 'costPerTask', 'costPerInspection', 'vendorRevenue'])
  ok('money: ' + k, isMoneyKey(k) === true)

// Counts and known-flags whose names contain a money word but which are not amounts. Nulling any
// of these makes the board read "no data" instead of "withheld".
for (const k of ['turnsFromListingFee', 'turnsUnpriced', 'costKnown', 'labourKnown'])
  ok('kept (not an amount): ' + k, isMoneyKey(k) === false)

for (const k of ['laborPct', 'goalPct', 'marginPct', 'sharePct', 'payrollSharePct',
  'billableCoveragePct', 'utilizationPct', 'scheduledVsActualPct', 'vendorMixPct',
  'supervisorSharePct', 'costDataCoverage', 'revenuePerLaborDollar', 'billableTasks',
  'checkoutsWithNoFeeData', 'hours', 'cleans', 'people', 'name', 'date', 'band', 'tasksCompleted',
  'clockedHours', 'overtimeHours', 'projectedWeekHours', 'inspections', 'market'])
  ok('kept: ' + k, isMoneyKey(k) === false)

// ---------------------------------------------------------------- carve-outs
console.log('\ncarve-outs')
eq('string under a money key is a label, not an amount',
  redactMoney({ source: { hours: 'breezeway', payroll: 'homebase' }, costBasis: 'homebase payroll' }),
  { source: { hours: 'breezeway', payroll: 'homebase' }, costBasis: 'homebase payroll' })

eq('a surname that reads like a field is not a field',
  redactMoney({ personTasks: { 'Rosa Costa': [{ unit: '12B', minutes: 40, pay: 55 }] } }),
  { personTasks: { 'Rosa Costa': [{ unit: '12B', minutes: 40, pay: null }] } })

eq('opaque only suspends the key test one level down',
  redactMoney({ personTasks: { 'Ana Feeney': [{ task: 'Clean', payroll: 9 }] } }),
  { personTasks: { 'Ana Feeney': [{ task: 'Clean', payroll: null }] } })

eq('a name-keyed map of pure amounts dies whole — no surname is trusted',
  redactMoney({ personRevenue: { 'Maria Gomez': 3200, 'Rosa Costa': 900 } }),
  { personRevenue: null })

ok('input is never mutated', (() => {
  const input = { payroll: { actual: 500 } }
  redactMoney(input)
  return input.payroll.actual === 500
})())

eq('arrays of rows', redactMoney([{ name: 'A', cleans: 3, margin: 40 }]), [{ name: 'A', cleans: 3, margin: null }])
eq('nulls and falsy pass through', redactMoney({ payroll: null, hours: 0, open: false }), { payroll: null, hours: 0, open: false })

// ---------------------------------------------------------------- the real payload
console.log('\nfull /api/labor/kpi payload')
const payload = {
  ok: true, market: 'all',
  week: { start: '2026-08-09', end: '2026-08-15', weekStart: 'sunday' },
  range: { start: '2026-08-04', end: '2026-08-10' },
  totalScheduledHours: 310, totalActualHours: 298.4, totalOvertimeHours: 6.2,
  totalLaborCost: 5210.44, costDataCoverage: 0.98, cleansCompleted: 142,
  hoursPerClean: 1.4, laborCostPerOccupiedNight: 12.9,
  people: [{ name: 'Rosa Costa', scheduledHours: 40, actualHours: 41.5, overtimeHours: 1.5,
    wageRate: 17.5, laborCost: 726.25, projectedWeekHours: 41.5, overtimeRisk: true, openTimecard: false, noShow: false }],
  flags: { overtimeRisk: ['Rosa Costa'], noShows: [], stillClockedIn: [] },
  tasks: { total: 210, clean: 142, inspection: 24, maintenance: 31, other: 13 },
  economics: { cleaningRevenue: 18400, cleaningRevenueInhouse: 15200, cleaningRevenueVendor: 3200,
    cleaningLaborCost: 5210.44, cleaningMargin: 9989.56, revenuePerLaborDollar: 2.92,
    costBasis: 'breezeway rate_paid' },
  payroll: { actual: 5210.44, scheduled: 5400, revenue: 18400, revenueInhouse: 15200,
    revenueVendor: 3200, laborPct: 34.3, band: 'watch', scheduledVsActualPct: 96.5,
    vendorMixPct: 17.4, goalPct: 30, note: 'payroll = Homebase timecard costs' },
  today: { date: '2026-08-10', clockedInNow: ['Rosa Costa'], hoursSoFar: 22.5, payrollSoFar: 390.5,
    scheduledPayroll: 420, cleaningRevenueToday: 1850, tasksDoneToday: 18, laborPct: 21.1, vsScheduledPct: 93 },
  departments: {
    housekeeping: { people: 9, hours: 210, payroll: 3900, supervisorPayroll: 600, cleanerPayroll: 3300,
      supervisors: ['Ernesto Torres'], revenue: 15200, vendorRevenue: 3200, margin: 11300,
      costPerClean: 27.46, feePerClean: 107.04, departureCleans: 142, otherHkTasks: 12,
      laborPct: 25.7, marginPct: 74.3, supervisorSharePct: 15.4, payrollSharePct: 74.9 },
    inspection: { people: 2, hours: 40, payroll: 700, inspections: 24, costPerInspection: 29.17, payrollSharePct: 13.4 },
    maintenance: { people: 2, hours: 38.5, payroll: 610.44, clockedHours: 48,
      source: { hours: 'breezeway', payroll: 'homebase' }, tasksCompleted: 31,
      teamNames: ['Luis Fee'], taskHours: 38.5, utilizationPct: 80.2, costPerTask: 19.69,
      billableRevenue: 1565, billableTasks: 22, billableMargin: 954.56,
      billableCoveragePct: 256.4, payrollSharePct: 11.7 },
  },
  weekSchedule: [{ date: '2026-08-09', people: [{ name: 'Rosa Costa', role: 'Cleaner', start: '09:00', end: '17:00' }] }],
  perCleaner: [{ name: 'Rosa Costa', role: 'Cleaner', area: 'miami', cleans: 22, checkoutsAttributed: 20,
    revenueGenerated: 2140, taskPay: 660, payroll: 726.25, hours: 41.5, margin: 1413.75,
    revenuePerLaborDollar: 2.95, avgFeePerClean: 107, marginPct: 66.1, laborPct: 33.9, sharePct: 14.1 }],
  personTasks: { 'Rosa Costa': [{ date: '2026-08-05', unit: '12B', task: 'Departure Clean', kind: 'clean', minutes: 95, pay: 55 }] },
  personRevenue: { 'Rosa Costa': 2140 },
  attribution: { totalCleaningRevenue: 18400, attributedRevenue: 17100, rate: 0.93, reliable: true },
  unattributed: { feesWithNoMatchedClean: 1300, checkoutsWithNoFeeData: 4, cleansWithNoAssignee: 2, cleansWithNoMatchedCheckout: 5 },
  settings: { market: 'all', pct_good: 30, pct_bad: 40, ot_weekly_hours: 40, attribution_min: 0.85 },
  nameAliases: { 'rosa costa': 'Rosa Costa' },
}

const hidden = redactMoney(payload)

// THE REAL GUARD. Walk the redacted payload and fail on any surviving number under a key that reads
// like money. This is what catches a field added to the route six months from now.
const leaks = []
;(function audit(v, path, keysAreData) {
  if (Array.isArray(v)) return v.forEach((x, i) => audit(x, `${path}[${i}]`, false))
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (!keysAreData && isMoneyKey(k) && typeof v[k] === 'number') leaks.push(`${path}.${k} = ${v[k]}`)
      audit(v[k], `${path}.${k}`, k === 'personTasks')
    }
  }
})(hidden, '$', false)
ok('no dollar amount survives redaction', leaks.length === 0, leaks.join(', '))

// ...and the percentages Jon asked to keep are all still there.
for (const [label, got] of [
  ['payroll.laborPct', hidden.payroll.laborPct],
  ['payroll.scheduledVsActualPct', hidden.payroll.scheduledVsActualPct],
  ['payroll.vendorMixPct', hidden.payroll.vendorMixPct],
  ['payroll.band', hidden.payroll.band],
  ['today.laborPct', hidden.today.laborPct],
  ['hk.marginPct', hidden.departments.housekeeping.marginPct],
  ['hk.payrollSharePct', hidden.departments.housekeeping.payrollSharePct],
  ['mt.utilizationPct', hidden.departments.maintenance.utilizationPct],
  ['mt.billableCoveragePct', hidden.departments.maintenance.billableCoveragePct],
  ['mt.billableTasks', hidden.departments.maintenance.billableTasks],
  ['cleaner.marginPct', hidden.perCleaner[0].marginPct],
  ['cleaner.sharePct', hidden.perCleaner[0].sharePct],
  ['cleaner.revenuePerLaborDollar', hidden.perCleaner[0].revenuePerLaborDollar],
  ['attribution.rate', hidden.attribution.rate],
  ['economics.revenuePerLaborDollar', hidden.economics.revenuePerLaborDollar],
]) ok('kept: ' + label, got != null && got !== '')

// Non-money operating facts must be untouched — hiding dollars must not blind the board.
eq('hours survive', hidden.totalActualHours, 298.4)
eq('OT survives', hidden.totalOvertimeHours, 6.2)
eq('task counts survive', hidden.tasks, payload.tasks)
eq('flags survive', hidden.flags, payload.flags)
eq('schedule survives', hidden.weekSchedule, payload.weekSchedule)
eq('cleaner cleans survive', hidden.perCleaner[0].cleans, 22)
eq('person hours survive', hidden.people[0].actualHours, 41.5)
eq('drill-down survives minus the pay', hidden.personTasks['Rosa Costa'][0].minutes, 95)
eq('method labels survive', hidden.departments.maintenance.source, { hours: 'breezeway', payroll: 'homebase' })
eq('teamNames survive despite a surname called Fee', hidden.departments.maintenance.teamNames, ['Luis Fee'])
eq('aliases survive', hidden.nameAliases, payload.nameAliases)
eq('settings survive', hidden.settings, payload.settings)

// Spot-check that the amounts really are gone where it matters most.
eq('wage rate gone', hidden.people[0].wageRate, null)
eq('per-person payroll gone', hidden.people[0].laborCost, null)
eq('person revenue map gone whole', hidden.personRevenue, null)
eq('total labor cost gone', hidden.totalLaborCost, null)
eq('cleaning revenue gone', hidden.economics.cleaningRevenue, null)

// ---------------------------------------------------------------- who sees it
// Jon 2026-08-10: "only view of that data should be me ... i should be able to toggle on and off
// per user". The owner always; everyone else only when he has switched them on. No role grants it.
console.log('\ncanSeeMoney')
const OWNER = 'jon@stay-hospitality.com'
ok('the owner always sees amounts', canSeeMoney({ email: OWNER, features: {} }))
ok('the owner is matched case-insensitively', canSeeMoney({ email: 'Jon@Stay-Hospitality.com', features: {} }))
ok('the owner cannot be switched off by a row edit', canSeeMoney({ email: OWNER, features: { money: false } }))

// NO ROLE GRANTS IT — this is the whole point of the change. Every one of these used to pass.
ok('admin role does NOT see amounts', !canSeeMoney({ email: 'a@x.com', role: 'admin', accessRole: 'admin', workspace: 'admin', features: {} }))
ok('manager / GM does NOT see amounts', !canSeeMoney({ email: 'gm@x.com', role: 'member', accessRole: 'manager', workspace: 'gm', features: {} }))
ok('ops does not', !canSeeMoney({ email: 'o@x.com', accessRole: 'ops', workspace: 'ops', features: {} }))
ok('cs_manager does not', !canSeeMoney({ email: 'c@x.com', accessRole: 'cs_manager', workspace: 'cs', features: {} }))
ok('data does not', !canSeeMoney({ email: 'd@x.com', accessRole: 'data', workspace: 'data', features: {} }))
// normWorkspace() turns a missing column into 'gm'. If canSeeMoney trusted workspace, every
// un-migrated user would be handed the payroll.
ok('un-migrated user (workspace defaults to gm) does NOT see amounts',
  !canSeeMoney({ email: 'u@x.com', accessRole: null, workspace: 'gm', features: {} }))

// The per-user switch.
ok('switched on', canSeeMoney({ email: 'o@x.com', accessRole: 'ops', features: { money: true } }))
ok('switched off', !canSeeMoney({ email: 'o@x.com', accessRole: 'ops', features: { money: false } }))
ok('never set = off', !canSeeMoney({ email: 'o@x.com', accessRole: 'ops', features: {} }))
ok('null features = off', !canSeeMoney({ email: 'o@x.com', features: null }))
ok('undefined features = off', !canSeeMoney({ email: 'o@x.com' }))
// Only an explicit boolean true. A truthy string must not open the door.
for (const v of ['true', 'yes', 1, 'full', 'view', {}, []])
  ok('truthy non-true (' + JSON.stringify(v) + ') = off', !canSeeMoney({ email: 'o@x.com', features: { money: v } }))
ok('an unrelated features flag changes nothing', !canSeeMoney({ email: 'o@x.com', features: { labor: 'view' } }))
ok('no email = off', !canSeeMoney({ email: null, features: {} }))

// The transcription above must match lib/access.ts, or these tests prove nothing.
const accessSrc = readFileSync(new URL('../lib/access.ts', import.meta.url), 'utf8')
const fn = accessSrc.slice(accessSrc.indexOf('export function canSeeMoney'))
  .split('\n}')[0].replace(/\s+/g, ' ')
ok('test copy of canSeeMoney still matches lib/access.ts', [
  "if (isSuperadmin(access.email)) return true",
  "return (access.features as any)?.money === true",
].every(s => fn.includes(s)), fn)
ok('SUPERADMIN constant still matches lib/access.ts',
  new RegExp("SUPERADMIN\\s*=\\s*'" + OWNER + "'").test(accessSrc))

// The users API must let the switch through — it sanitises `features` on write, and `money` is not
// a page feature, so without an explicit rule it would be silently dropped on every save.
const usersSrc = readFileSync(new URL('../app/api/users/route.ts', import.meta.url), 'utf8')
ok('users API stores extra perms', /isExtraPerm\(k\)\s*\)\s*\{\s*clean\[k\]\s*=\s*body\.features\[k\]\s*===\s*true/.test(usersSrc.replace(/\s+/g, ' ')) || usersSrc.includes('isExtraPerm(k)'), 'no isExtraPerm branch in app/api/users/route.ts')
ok('users API stores extra perms as strict booleans', usersSrc.includes("body.features[k] === true"))
// The KPI home board must use the SHARED rule, not its own. It carried a second definition
// (admin OR workspace admin/gm/data) that survived the 2026-08-10 change and disagreed with the
// labor board about the same person — and it read `workspace`, which defaults to 'gm'.
const kpiSrc = readFileSync(new URL('../lib/kpi.ts', import.meta.url), 'utf8')
ok('KPI board uses the shared canSeeMoney', /canSeeMoney\(access\)/.test(kpiSrc))
ok('KPI board no longer defines its own money rule',
  !/access\.workspace === 'gm'/.test(kpiSrc) && !/canSeeMoney = access\.role/.test(kpiSrc))
ok('KPI board redacts the payload when money is hidden', /redactMoney\(payload\)/.test(kpiSrc))
// KpiHome renders against payload.canSeeMoney. Emitting it as bare shorthand now resolves to the
// IMPORTED FUNCTION, which JSON.stringify drops — the board would then hide money from everyone,
// owner included. It has to be the boolean.
ok('KPI board sends canSeeMoney as the boolean, not the imported function',
  /canSeeMoney: showMoney/.test(kpiSrc) && !/^\s*canSeeMoney,\s*$/m.test(kpiSrc))
// marketRows / buildingRows were never wrapped in money(); the redactor is what covers them.
ok('KPI market rows still emit a cost field for the redactor to strip', /market: m, units, done: w\.done, cost:/.test(kpiSrc))

const featSrc = readFileSync(new URL('../lib/features.ts', import.meta.url), 'utf8')
ok('money is registered in EXTRA_PERMS', /EXTRA_PERMS[\s\S]{0,400}?key:\s*'money'/.test(featSrc))
// check-tabs.mjs scrapes this file for `path: '...'` to build the route census — an extra perm
// must never look like a page to it.
const extraBlock = (featSrc.match(/EXTRA_PERMS[\s\S]*?\n\]/) || [''])[0]
ok('EXTRA_PERMS declares no path (would break the route census)', !/path:/.test(extraBlock))

// ---------------------------------------------------------------- pctOf
console.log('\npctOf')
eq('basic', pctOf(30, 120), 25)
eq('one decimal', pctOf(1, 3), 33.3)
eq('divide by zero is not a fact', pctOf(50, 0), null)
eq('null in, null out', pctOf(null, 100), null)
eq('undefined in, null out', pctOf(undefined, 100), null)
eq('zero numerator is a real answer', pctOf(0, 100), 0)
eq('over 100 is allowed (billable vs wages)', pctOf(1565, 610.44), 256.4)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

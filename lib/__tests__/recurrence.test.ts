// RECURRENCE — when the next one is made.
//
// A 1:1 that drifts a day, or fires twice, is a 1:1 nobody trusts. Run: npx tsx lib/__tests__/recurrence.test.ts
import { nextOccurrence, describeRecurrence, settingsOf } from '../projects-shared'

let failed = 0
const eq = (why: string, got: any, want: any) => { if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ } }

// 2026-09-08 is a Tuesday.
eq('weekly Monday from Tuesday',        nextOccurrence({ every: 'week', weekday: 1 }, '2026-09-08'), '2026-09-14')
eq('weekly Tuesday from Tuesday → next week', nextOccurrence({ every: 'week', weekday: 2 }, '2026-09-08'), '2026-09-15')
eq('weekly Friday from Tuesday',        nextOccurrence({ every: 'week', weekday: 5 }, '2026-09-08'), '2026-09-11')
eq('advance a weekly series',           nextOccurrence({ every: 'week', weekday: 1 }, '2026-09-14'), '2026-09-21')
eq('biweekly first from an off day',    nextOccurrence({ every: '2weeks', weekday: 1 }, '2026-09-08'), '2026-09-14')
eq('advance a biweekly series',         nextOccurrence({ every: '2weeks', weekday: 1 }, '2026-09-14'), '2026-09-28')
eq('monthly 15th from the 8th',         nextOccurrence({ every: 'month', day: 15 }, '2026-09-08'), '2026-09-15')
eq('monthly 1st from the 8th',          nextOccurrence({ every: 'month', day: 1 }, '2026-09-08'), '2026-10-01')
eq('advance a monthly series',          nextOccurrence({ every: 'month', day: 15 }, '2026-09-15'), '2026-10-15')
eq('monthly clamps to 28',              nextOccurrence({ every: 'month', day: 31 }, '2026-01-30'), '2026-02-28')
eq('year boundary',                     nextOccurrence({ every: 'month', day: 5 }, '2026-12-20'), '2027-01-05')
eq('sunday weekday 0',                  nextOccurrence({ every: 'week', weekday: 0 }, '2026-09-08'), '2026-09-13')

eq('describe weekly',   describeRecurrence({ every: 'week', weekday: 1, next_on: '' }), 'Weekly on Mon')
eq('describe monthly',  describeRecurrence({ every: 'month', day: 3, next_on: '' }), 'Monthly on the 3rd')
eq('describe monthly 15th', describeRecurrence({ every: 'month', day: 15, next_on: '' }), 'Monthly on the 15th')

eq('settings default view',  settingsOf(null).view, 'list')
eq('settings bad accent',    settingsOf({ accent: 'neon' }).accent, 'indigo')
eq('settings board view',    settingsOf({ view: 'board', hideDone: true }).hideDone, true)

console.log(failed === 0 ? 'recurrence: all 18 checks passed' : `recurrence: ${failed} FAILED`)
if (failed) process.exit(1)

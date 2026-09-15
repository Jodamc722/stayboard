// THE DAILY CHECKLIST — the clock.
//
// The only thing that makes this a checklist rather than a list is that it knows what time it is,
// so the time logic is the part worth pinning down.
// Run: npx tsx lib/__tests__/daily-checklist.test.ts
import { minutesOf, clockLabel, isLate, progressOf, opsNow } from '../checklist-shared'

let failed = 0
const eq = (why: string, got: any, want: any) => { if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ } }

// ── READING A TIME ──────────────────────────────────────────────────────────────────────────────
// Postgres hands back "09:00:00"; a browser time input gives "09:00". Both are the same moment.
eq('postgres time',      minutesOf('09:00:00'), 540)
eq('input time',         minutesOf('09:00'), 540)
eq('afternoon',          minutesOf('14:30:00'), 870)
eq('midnight',           minutesOf('00:00'), 0)
eq('last minute',        minutesOf('23:59'), 1439)
eq('no time is null',    minutesOf(null), null)
eq('empty is null',      minutesOf(''), null)
eq('words are null',     minutesOf('morning'), null)
// Garbage must not become a real time. A 25:00 read as 1500 minutes would make an item that can
// never be late, silently.
eq('hour out of range',  minutesOf('25:00'), null)
eq('minute out of range', minutesOf('09:75'), null)

eq('morning reads',      clockLabel('09:00:00'), '9:00 AM')
eq('afternoon reads',    clockLabel('14:30:00'), '2:30 PM')
eq('noon is PM',         clockLabel('12:00'), '12:00 PM')
eq('midnight is AM',     clockLabel('00:00'), '12:00 AM')
eq('minutes padded',     clockLabel('13:05'), '1:05 PM')
eq('nothing reads back', clockLabel(null), null)

// ── LATE ────────────────────────────────────────────────────────────────────────────────────────
// Three conditions at once: it has a time, the time has passed, and nobody ticked it.
const NOON = 12 * 60
eq('past and untouched',      isLate('10:00', false, NOON), true)
eq('past but done',           isLate('10:00', true,  NOON), false)
eq('still to come',           isLate('14:00', false, NOON), false)
eq('due this very minute',    isLate('12:00', false, NOON), false)   // "by noon" is not late AT noon
eq('one minute past',         isLate('11:59', false, NOON), true)
// An item with no time can NEVER be late. Plenty of daily work just has to happen sometime, and
// colouring it red would teach people to ignore red.
eq('no time is never late',   isLate(null, false, NOON), false)
eq('no time, done',           isLate(null, true, NOON), false)
eq('unreadable time',         isLate('whenever', false, NOON), false)

// ── HOW THE DAY IS GOING ────────────────────────────────────────────────────────────────────────
{
  const r = (done: boolean, late: boolean, inMin: number | null, id = '') => ({ done, late, in_minutes: inMin, id })
  const rows = [
    r(true,  false, -120, 'a'),   // done this morning
    r(false, true,  -30,  'b'),   // late
    r(false, false, 45,   'c'),   // next
    r(false, false, 200,  'd'),
    r(false, false, null, 'e'),   // no time
  ]
  const p = progressOf(rows)
  eq('total',            p.total, 5)
  eq('done',             p.done, 1)
  eq('late',             p.late, 1)
  eq('percent',          p.pct, 20)
  eq('next is soonest ahead', (p.next as any)?.id, 'c')
  // A late item is behind you, not ahead of you — offering it as "next" would be telling somebody
  // to do the thing they have already missed instead of the thing they can still catch.
  eq('next is not the late one', (p.next as any)?.id === 'b', false)
}
{
  const p = progressOf([])
  eq('empty is not NaN', p.pct, 0)
  eq('empty has no next', p.next, null)
}
{
  const all = progressOf([{ done: true, late: false, in_minutes: -10 }, { done: true, late: false, in_minutes: -5 }])
  eq('all done is 100', all.pct, 100)
  eq('all done has no next', all.next, null)
}

// ── THE OPERATING DAY ───────────────────────────────────────────────────────────────────────────
// 03:30 UTC is still the previous evening in New York. Storing the day as a date on the buildings'
// clock is what stops a late tick landing on tomorrow's list.
{
  const lateNight = opsNow(new Date('2026-09-16T03:30:00Z'))
  eq('UTC small hours are still yesterday here', lateNight.day, '2026-09-15')
  eq('and it reads as 11:30pm',                  lateNight.clock, '23:30')

  const midMorning = opsNow(new Date('2026-09-15T14:00:00Z'))
  eq('mid-morning day',   midMorning.day, '2026-09-15')
  eq('mid-morning clock', midMorning.clock, '10:00')
  eq('mid-morning minutes', midMorning.minutes, 600)
}

console.log(failed ? `\n${failed} FAILED` : '\nAll daily checklist checks passed.')
process.exit(failed ? 1 : 0)

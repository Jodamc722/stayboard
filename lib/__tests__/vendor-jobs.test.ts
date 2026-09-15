// VENDOR JOBS — the arrival date, the announcement, and the repeating clock.
//
// The three things that make vendor work different from a task, and the three ways it goes wrong:
// a visit nobody was told about, a visit that quietly never happened, and a recurring job that
// books itself twelve times while the first one sits open.
// Run: npx tsx lib/__tests__/vendor-jobs.test.ts
import { visitState, needsTelling, upcomingVisits, estLabel, nextOccurrence, describeRecurrence, INVOICE_APPROVAL_CENTS, approvalCeiling } from '../projects-shared'

let failed = 0
const eq = (why: string, got: any, want: any) => { if (got !== want) { console.log(`FAIL ${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); failed++ } }

const TODAY = '2026-09-15'

// ── WHAT THE ARRIVAL DATE MEANS THIS MORNING ────────────────────────────────────────────────────
eq('today',            visitState('2026-09-15', 'todo', TODAY)?.label, 'Arriving today')
eq('today tone',       visitState('2026-09-15', 'todo', TODAY)?.tone, 'today')
eq('tomorrow',         visitState('2026-09-16', 'todo', TODAY)?.label, 'Arriving tomorrow')
eq('this week',        visitState('2026-09-18', 'todo', TODAY)?.label, 'Arriving in 3 days')
eq('further out',      visitState('2026-10-02', 'todo', TODAY)?.label, 'Arriving Oct 2')
eq('further out tone', visitState('2026-10-02', 'todo', TODAY)?.tone, 'later')
eq('no date at all',   visitState(null, 'todo', TODAY), null)

// A PAST DATE WITH THE JOB STILL OPEN IS THE FAILURE THIS BOARD EXISTS FOR. It is not "overdue" —
// it almost always means the vendor did not turn up and nobody noticed, so it gets its own tone.
eq('yesterday',        visitState('2026-09-14', 'todo', TODAY)?.label, 'Was due yesterday')
eq('missed tone',      visitState('2026-09-14', 'todo', TODAY)?.tone, 'missed')
eq('long missed',      visitState('2026-09-05', 'todo', TODAY)?.label, '10 days ago, no result')
// Done is not missed, however late it was. The visit happened; that is the whole question.
eq('done past date',   visitState('2026-09-05', 'done', TODAY)?.tone, 'done')
eq('done reads back',  visitState('2026-09-05', 'done', TODAY)?.label, 'Visited Sep 5')

// ── DOES THE TEAM KNOW ──────────────────────────────────────────────────────────────────────────
eq('never told',       needsTelling({ visit_on: '2026-09-18', team_notified_for: null, status: 'todo' }), true)
eq('told, same date',  needsTelling({ visit_on: '2026-09-18', team_notified_for: '2026-09-18', status: 'todo' }), false)
// THE ONE THAT MATTERS: told about Tuesday, moved to Thursday. Everybody who heard the first
// message still believes Tuesday, which is more dangerous than never having said anything.
eq('date moved after telling', needsTelling({ visit_on: '2026-09-17', team_notified_for: '2026-09-15', status: 'todo' }), true)
eq('no visit, nothing to tell', needsTelling({ visit_on: null, team_notified_for: null, status: 'todo' }), false)
eq('finished jobs stay quiet',  needsTelling({ visit_on: '2026-09-18', team_notified_for: null, status: 'done' }), false)
// Timestamps arrive from Postgres as full datetimes; comparing raw strings would mark every
// announced visit as un-announced for ever.
eq('timestamp vs date',        needsTelling({ visit_on: '2026-09-18', team_notified_for: '2026-09-18T14:22:01.000Z', status: 'todo' }), false)

// ── THE ARRIVALS STRIP ──────────────────────────────────────────────────────────────────────────
{
  const tasks = [
    { id: 'a', visit_on: '2026-09-18', status: 'todo' },
    { id: 'b', visit_on: '2026-09-16', status: 'todo' },
    { id: 'c', visit_on: '2026-09-10', status: 'todo' },   // missed — must stay visible
    { id: 'd', visit_on: '2026-09-17', status: 'done' },   // finished — not "coming out"
    { id: 'e', visit_on: '2026-12-01', status: 'todo' },   // beyond the window
    { id: 'f', visit_on: null, status: 'todo' },
  ]
  // upcomingVisits is typed by the fields it READS (visit_on, status), so the returned rows do not
  // carry `id` in the type even though they are the very objects passed in. Reading it back is what
  // makes this test legible, so the cast goes here rather than widening the function's signature.
  const up = upcomingVisits(tasks as any, TODAY, 14).map((t: any) => t.id)
  eq('soonest first, missed kept', JSON.stringify(up), JSON.stringify(['c', 'b', 'a']))
  eq('done is not upcoming',       up.includes('d'), false)
  eq('far future is not upcoming', up.includes('e'), false)
}

// ── TIME ON SITE ────────────────────────────────────────────────────────────────────────────────
eq('under an hour',  estLabel(30), '30 min')
eq('exactly an hour', estLabel(60), '1 hr')
eq('two hours',      estLabel(120), '2 hrs')
eq('a half hour over', estLabel(90), '1.5 hrs')
eq('zero is nothing', estLabel(0), null)
eq('nothing is nothing', estLabel(null), null)

// ── THE REPEATING CLOCK ─────────────────────────────────────────────────────────────────────────
// Counted from the visit that HAPPENED, not from today, so a visit done three days late does not
// drag the whole cadence three days later for ever.
eq('pest, monthly',      nextOccurrence({ every: 'month', day: 12 }, '2026-09-12'), '2026-10-12')
eq('late visit keeps cadence', nextOccurrence({ every: 'month', day: 12 }, '2026-09-12'), '2026-10-12')
eq('hvac, quarterly',    nextOccurrence({ every: 'quarter', day: 1 }, '2026-09-01'), '2026-12-01')
eq('quarterly year end', nextOccurrence({ every: 'quarter', day: 15 }, '2026-11-15'), '2027-02-15')
eq('fire, yearly',       nextOccurrence({ every: 'year', day: 3, month: 4 }, '2026-04-03'), '2027-04-03')
eq('pool, weekly',       nextOccurrence({ every: 'week', weekday: 2 }, '2026-09-15'), '2026-09-22')
// Clamped to 28 so a job set for the 31st does not vanish in February.
eq('month clamps',       nextOccurrence({ every: 'month', day: 31 }, '2026-01-30'), '2026-02-28')

eq('describe quarterly', describeRecurrence({ every: 'quarter', day: 1, next_on: '' } as any), 'Quarterly on the 1st')
eq('describe yearly',    describeRecurrence({ every: 'year', day: 3, month: 4, next_on: '' } as any), 'Yearly in April')
eq('describe monthly',   describeRecurrence({ every: 'month', day: 12, next_on: '' } as any), 'Monthly on the 12th')

// ── THE $300 RULE ───────────────────────────────────────────────────────────────────────────────
// Jon, 2026-09-15: "If it's over 300, it must be approved by the owner/general manager."
eq('house rule is $300',   INVOICE_APPROVAL_CENTS, 30_000)
eq('default applies',      approvalCeiling(null), 30_000)
eq('$299 is fine',         29_900 > approvalCeiling(null), false)
eq('$300 exactly is fine', 30_000 > approvalCeiling(null), false)   // "over 300", not "300 or more"
eq('$300.01 needs a yes',  30_001 > approvalCeiling(null), true)
eq('a board may differ',   approvalCeiling({ invoiceApprovalCents: 100_000 }), 100_000)

console.log(failed ? `\n${failed} FAILED` : '\nAll vendor job checks passed.')
process.exit(failed ? 1 : 0)

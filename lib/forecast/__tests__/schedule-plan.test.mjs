// node lib/forecast/__tests__/schedule-plan.test.mjs
//
// THE NEXT-WEEK PLAN'S ARITHMETIC (lib/forecast/plan-core.ts) is the Scheduler rail's KPI model:
// KPI hours + projected + growth buffer → needed at one shift, rounded up once with a quarter-hour of
// slack; scheduled = working × shift; on-call shown, not counted. Plain node, no deps.
const P = await import('../plan-core.ts')
const { planDay, planMoves, summarize, planText } = P

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const S = { shiftHours: 8, growthPct: 10 }
const day = (x = {}) => ({ date: '2026-11-15', label: 'Sat Nov 15', dow: 'Sat', lead: 5, market: 'Broward', booked: 10, expected: 10, history: null, kpiHoursBooked: 25, hoursPerClean: 2.5, working: 3, onCall: 0, rosterKnown: true, ...x })

// 1. The rail's numbers: 25h KPI, nothing projected, 10% buffer = 27.5h → 4 people; 3 working = 24h → short 1.
{
  const d = planDay(day(), S)
  ok('KPI hours carried', d.kpiH === 25, String(d.kpiH))
  ok('buffer is 10% of KPI + projected', Math.abs(d.bufferH - 2.5) < 0.02, String(d.bufferH))
  ok('need rounds the pooled hours up once', d.need === 4, String(d.need))
  ok('short by one', d.verdict === 'short' && d.short === 1, d.verdict + ' ' + d.short)
  ok('gap is scheduled minus target', Math.abs(d.gapH - (24 - 27.5)) < 0.02, String(d.gapH))
}

// 2. A quarter-hour over a shift does not add a person (the rail's slack).
{
  const d = planDay(day({ kpiHoursBooked: 7.5, booked: 3, expected: 3, working: 1 }), { shiftHours: 8, growthPct: 10 })
  ok('8h 15m of work is one shift', d.need === 1, String(d.need) + ' target ' + d.targetH)
}

// 3. Likely cleans: the larger of booked, pickup and the weekday history; today is booked only.
{
  const later = planDay(day({ booked: 6, expected: 7.4, history: 9, kpiHoursBooked: 15 }), S)
  ok('history floor wins when larger', later.likely === 9 && later.projCleans === 3, later.likely + '/' + later.projCleans)
  ok('projected hours priced at the market rate', Math.abs(later.projH - 7.5) < 0.02, String(later.projH))
  const today = planDay(day({ lead: 0, booked: 6, expected: 7.4, history: 9, kpiHoursBooked: 15 }), S)
  ok('today is what is booked', today.likely === 6 && today.projCleans === 0)
}

// 4. On-call is not counted; an unpublished roster is "unknown", never "short".
{
  const d = planDay(day({ working: 2, onCall: 2 }), S)
  ok('on-call not in scheduled hours', d.schedH === 16)
  const u = planDay(day({ rosterKnown: false, working: 0 }), S)
  ok('no roster = unknown', u.verdict === 'unknown' && u.short === 0)
  const n = planDay(day({ booked: 0, expected: 0, kpiHoursBooked: 0, history: 0 }), S)
  ok('nothing likely = none', n.verdict === 'none' && n.need === 0)
}

// 5. Moves: call in on-call first, then move deferrable work to the day with room, then add.
{
  const sat = planDay(day({ working: 2, onCall: 1, deferrable: 4 }), S)        // needs 4, 2 working
  const tue = planDay(day({ date: '2026-11-18', dow: 'Tue', label: 'Tue Nov 18', booked: 3, expected: 3, kpiHoursBooked: 7.5, working: 3 }), S)
  const mv = planMoves([sat, tue], 3)
  ok('first move is the on-call', mv[0] && mv[0].kind === 'call_in', JSON.stringify(mv[0]))
  ok('second moves deep cleans to Tue', mv[1] && mv[1].kind === 'move' && /to Tue/.test(mv[1].text), JSON.stringify(mv[1]))
  ok('third adds the rest', mv[2] && mv[2].kind === 'add' && /Add 1 cleaner Sat in Broward/.test(mv[2].text), JSON.stringify(mv[2]))
  ok('never more than three', planMoves([sat, tue, sat, sat], 3).length <= 3)
}

// 6. Unpublished days become one "publish Homebase" move per market; nothing short → a release.
{
  const u1 = planDay(day({ rosterKnown: false, working: 0 }), S)
  const u2 = planDay(day({ date: '2026-11-16', dow: 'Sun', rosterKnown: false, working: 0 }), S)
  const mv = planMoves([u1, u2], 3)
  ok('one publish move for the market', mv.length === 1 && mv[0].kind === 'publish' && /needs 4, 4/.test(mv[0].text), JSON.stringify(mv))
  const over = planDay(day({ working: 6 }), S)
  const rel = planMoves([over], 3)
  ok('over by a shift or more suggests a release', rel.length === 1 && rel[0].kind === 'release', JSON.stringify(rel))
}

// 7. The summary and the text stay short and say the KPI basis.
{
  const sat = planDay(day(), S)
  const s = summarize([sat])
  ok('headline names the short day', /Broward Sat \(−1\)/.test(s.headline), s.headline)
  const t = planText([sat], planMoves([sat]), '')
  ok('text carries the KPI basis', /KPI basis: 27\.5h expected labor vs 24h scheduled/.test(t), t)
  ok('text is short', t.split(/\s+/).length < 120)
}

console.log(`schedule-plan: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

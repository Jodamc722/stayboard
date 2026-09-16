// THE FOCUS RANKER — the judgement that used to cost a Fable call per board load.
//
// These are the cases the weights exist FOR. If someone retunes them, this file is the argument
// they have to answer: a duplicate outranks everything, a paid-for trip outranks a cold one, and a
// crew with no room does not get handed more work.
import { rankFocus, dupId, MAX_FOCUS } from '../ops-focus-rank'

let fail = 0
const eq = (label: string, got: any, want: any) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { console.log('FAIL', label, '\n  got ', g, '\n  want', w); fail++ } else console.log('ok  ', label)
}
const ok = (label: string, cond: boolean) => eq(label, !!cond, true)

const TODAY = '2026-09-16'
const sug = (o: any) => ({ id: 'S' + o.unit, unit: o.unit, building: o.building || o.unit, why: 'why ' + o.unit, daysOver: 0, vacantTonight: false, candidates: [], proximity: 'none', ...o })
const wait = (o: any) => ({ taskId: 'P' + o.unit, unit: o.unit, building: o.building || o.unit, recommendation: 'rec ' + o.unit, waitingDays: 0, target: null, ...o })
const dup = (o: any) => ({ listingId: o.unit, unit: o.unit, building: o.building || o.unit, date: TODAY, key: 'pest-control', keepId: 'k', tasks: [1, 2] })
const roomy = { people: [{ person: 'Helem', utilisationPct: 40, headroomCleans: 3 }] }
const full = { people: [{ person: 'Helem', utilisationPct: 118, headroomCleans: 0 }] }

// ── a duplicate is the cheapest win on the page ────────────────────────────────────────────────
{
  const v = rankFocus(TODAY, [sug({ unit: 'A', proximity: 'building', daysOver: 40 })] as any,
    [wait({ unit: 'B', target: { date: TODAY, vacant: true, hasTrade: true, who: ['Helem'] }, waitingDays: 40 })] as any,
    [dup({ unit: 'C' })] as any, roomy as any)
  eq('duplicate ranks first', v.focus[0].id, 'dup:C|' + TODAY + '|pest-control')
  eq('a duplicate is a cancel', v.focus[0].do, 'cancel')
  ok('and the free trip is right behind it', v.focus[1].id === 'PB')
}

// ── somebody already driving there beats somebody who would have to ────────────────────────────
{
  const v = rankFocus(TODAY, [] as any, [
    wait({ unit: 'Cold', target: { date: TODAY, vacant: true, hasTrade: false, who: [] } }),
    wait({ unit: 'Free', target: { date: '2026-09-20', vacant: true, hasTrade: true, who: ['Marcos'] } }),
  ] as any, [] as any, roomy as any)
  eq('a paid-for trip outranks an empty unit today', v.focus[0].id, 'PFree')
  eq('and it is a move', v.focus[0].do, 'move')
}

// ── the engines' own sentence is what the reader gets ──────────────────────────────────────────
{
  const v = rankFocus(TODAY, [sug({ unit: 'A', proximity: 'building' })] as any, [] as any, [] as any, roomy as any)
  eq('a suggestion reuses Suggestion.why', v.focus[0].reason, 'why A')
  const w = rankFocus(TODAY, [] as any, [wait({ unit: 'B', target: { date: TODAY, vacant: true, hasTrade: true, who: ['x'] } })] as any, [] as any, roomy as any)
  eq('a waiting job reuses ReviewItem.recommendation', w.focus[0].reason, 'rec B')
}

// ── a full crew gets no new work, but duplicates still get cancelled ───────────────────────────
{
  const v = rankFocus(TODAY, [sug({ unit: 'A', proximity: 'building', daysOver: 30 })] as any, [] as any, [] as any, full as any)
  eq('nothing is added to a crew with no room', v.focus.length, 0)
  ok('and the headline says why', /room|capacity/i.test(v.headline))
  const w = rankFocus(TODAY, [sug({ unit: 'A', proximity: 'building' })] as any, [] as any, [dup({ unit: 'C' })] as any, full as any)
  eq('a cancel is exempt from the capacity rule', w.focus.length, 1)
  eq('and it is the duplicate', w.focus[0].do, 'cancel')
}

// ── never six jobs in one tower ────────────────────────────────────────────────────────────────
{
  const many = ['1', '2', '3', '4', '5'].map(n => sug({ id: 'S-eden-' + n, unit: 'Eden ' + n, building: 'Eden', proximity: 'building' }))
  const v = rankFocus(TODAY, many as any, [] as any, [] as any, roomy as any)
  eq('at most two picks from one building', v.focus.length, 2)
  ok('the rest are held back, and it says so', /one building/.test(v.parked))
}

// ── the cap, and the leftovers ─────────────────────────────────────────────────────────────────
{
  const many = Array.from({ length: 12 }, (_, i) => sug({ id: 'S' + i, unit: 'U' + i, building: 'B' + i, proximity: 'building' }))
  const v = rankFocus(TODAY, many as any, [] as any, [] as any, roomy as any)
  eq('never more than MAX_FOCUS', v.focus.length, MAX_FOCUS)
  eq('everything unpicked is reviewable', v.review.length, 12 - MAX_FOCUS)
  ok('and the count is stated', v.parked.indexOf(String(12 - MAX_FOCUS)) === 0)
}

// ── a quiet day says so rather than inventing work ─────────────────────────────────────────────
{
  const v = rankFocus(TODAY, [] as any, [] as any, [] as any, roomy as any)
  eq('nothing in means nothing out', v.focus.length, 0)
  eq('no leftovers, no parked sentence', v.parked, '')
  ok('the headline is a real sentence', v.headline.length > 20)
}

// ── same board, same answer, every time. This is the point of not using a model. ───────────────
{
  const mk = () => rankFocus(TODAY,
    [sug({ unit: 'A', proximity: 'area', daysOver: 12 }), sug({ unit: 'B', proximity: 'building' })] as any,
    [wait({ unit: 'C', target: { date: TODAY, vacant: true, hasTrade: true, who: ['q'] }, waitingDays: 9 })] as any,
    [dup({ unit: 'D' })] as any, roomy as any)
  eq('deterministic', JSON.stringify(mk()), JSON.stringify(mk()))
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed')
process.exit(fail ? 1 : 0)

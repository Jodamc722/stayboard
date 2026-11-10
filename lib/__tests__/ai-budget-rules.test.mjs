// node lib/__tests__/ai-budget-rules.test.mjs
// THE HARD STOP ON AI SPEND (lib/ai-budget-rules.ts): which call stops at which cap, what is exempt,
// what counts as a person waiting, the scheduled twins, the night shift's share, the runaway brake.
// Pure — no network, no database; lib/ai-budget.ts budgetBlock() asks decideBudget with the ledger's numbers.
import { readFileSync } from 'node:fs'
const { DEFAULT_BUDGET, INTERACTIVE, NEVER_CAPPED, WEEKLY_EXEMPT, NIGHTLY, AUTO_TWIN, decideBudget, nightlyAllowance, hourLimit } = await import('../ai-budget-rules.ts')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const st = (over = {}) => ({ day: 0, month: 0, hour: {}, nightly: 0, ...over, budget: { ...DEFAULT_BUDGET, ...(over.budget || {}) } })
const goes = (task, s) => decideBudget(task, s).blocked === null
const stops = (task, s, re) => { const b = decideBudget(task, s).blocked; return typeof b === 'string' && (!re || re.test(b)) }

console.log('\nthe defaults')
ok('$5 automatic, $9 total, $250 a month, 40 calls an hour, half for the night', DEFAULT_BUDGET.automaticUsd === 5 && DEFAULT_BUDGET.totalUsd === 9 && DEFAULT_BUDGET.monthUsd === 250 && DEFAULT_BUDGET.perTaskHour === 40 && DEFAULT_BUDGET.nightlyShare === 0.5 && DEFAULT_BUDGET.on === true && DEFAULT_BUDGET.paused === false)
ok('nothing spent → everything goes', ['eve', 'slack-watch', 'learn', 'review-reply', 'eve-review', 'guest-reply-auto', 'made-up-task'].every(t => goes(t, st())))

console.log('\nthe automatic cap ($5) stops background jobs and nobody a person is waiting on')
const at5 = st({ day: 5 })
for (const t of ['slack-watch', 'sentiment', 'ops-focus', 'learn', 'eve-brain', 'probe-writer', 'probe-judge', 'eve-correction', 'hk-damage', 'lost-found', 'call-notes', 'billing', 'made-up-task']) ok(`${t} stops at the automatic cap`, stops(t, at5, /Automatic AI jobs/))
for (const t of ['eve', 'eve-fast', 'eve-vision', 'memory-recall', 'guest-reply', 'expectations', 'eve-investigate', 'translate', 'listing-copy', 'reports', 'guidebook', 'project-plan', 'review-reply']) ok(`${t} keeps going past the automatic cap`, goes(t, at5))
ok('just under the automatic cap a background job still goes', goes('slack-watch', st({ day: 4.99 })))
ok('memory-recall is interactive (chat keeps its memory rerank after the automatic cap)', INTERACTIVE.has('memory-recall') && goes('memory-recall', st({ day: 8.99 })))

console.log('\nthe scheduled twins count against the automatic cap; the person\'s key does not')
ok('three twins, each named <key>-auto', Object.keys(AUTO_TWIN).sort().join() === 'eve-investigate,expectations,guest-reply' && Object.entries(AUTO_TWIN).every(([k, v]) => v === k + '-auto'))
for (const [person, auto] of Object.entries(AUTO_TWIN)) {
  ok(`${person} is interactive, ${auto} is not`, INTERACTIVE.has(person) && !INTERACTIVE.has(auto))
  ok(`${auto} stops at $5`, stops(auto, at5, /Automatic AI jobs/))
  ok(`${person} goes at $5`, goes(person, at5))
  ok(`${auto} goes under $5`, goes(auto, st({ day: 4.5 })))
  ok(`${auto} is not exempt from anything`, !NEVER_CAPPED.has(auto) && !WEEKLY_EXEMPT.has(auto) && !NIGHTLY.has(auto))
}
ok('translate has no twin (every caller is a person waiting)', !('translate' in AUTO_TWIN) && INTERACTIVE.has('translate'))
{ // The callers really use the twins, and the model registry knows each one and where its tier comes from.
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
  ok('the watch drafts under guest-reply-auto', /askModel\('guest-reply-auto'/.test(read('../eve/watches.ts')) && !/askModel\('guest-reply'/.test(read('../eve/watches.ts')))
  ok('the watch still drafts review replies under review-reply (exempt, as before)', /askModel\('review-reply'/.test(read('../eve/watches.ts')))
  ok('the investigator bills under eve-investigate-auto', /modelPairFor\('eve-investigate-auto'\)/.test(read('../eve/investigate.ts')) && /fallback, 'eve-investigate-auto'\)/.test(read('../eve/investigate.ts')) && !/'eve-investigate'\)/.test(read('../eve/investigate.ts')))
  ok('the expectations desk picks the twin only for a cron', read('../eve/expectations.ts').includes(`/^cron\\b/i.test(String(opts.by || '')) ? 'expectations-auto' : 'expectations'`))
  const models = read('../ai-models.ts')
  for (const [person, auto] of Object.entries(AUTO_TWIN)) ok(`ai-models: ${auto} inherits ${person}'s tier`, new RegExp(`key: '${auto}'[^\\n]*inherit: '${person}'`).test(models))
  ok('ai-models: ops-focus defaults to the Sonnet tier', /key: 'ops-focus'[^\n]*def: 'sonnet'/.test(models))
  ok('ai-models: the weekly review stays on the top tier', /key: 'eve-review'[^\n]*def: 'fable'/.test(models))
}

console.log('\nthe total cap ($9) stops everything but the exemptions')
const at9 = st({ day: 9 })
for (const t of ['eve', 'eve-fast', 'memory-recall', 'guest-reply', 'expectations', 'slack-watch', 'learn', 'guest-reply-auto']) ok(`${t} stops at the total cap`, stops(t, at9, /daily AI budget/))
ok('review replies are never capped by the day', goes('review-reply', at9) && goes('review-reply', st({ day: 500 })))
ok('the weekly review and the quality audit run on a spent day', goes('eve-review', at9) && goes('quality-audit', at9))
ok('just under the total cap chat still goes', goes('eve', st({ day: 8.99 })))

console.log('\nthe monthly cap ($250)')
const atMonth = st({ month: 250 })
for (const t of ['eve', 'slack-watch', 'eve-review', 'quality-audit', 'memory-recall', 'guest-reply-auto']) ok(`${t} stops at the monthly cap`, stops(t, atMonth, /monthly AI budget/))
ok('review replies are not stopped by the month either', goes('review-reply', atMonth))

console.log('\npause, and the budget switched off')
const paused = st({ budget: { paused: true } })
for (const t of ['review-reply', 'eve-review', 'eve', 'slack-watch', 'memory-recall']) ok(`Pause stops ${t}`, stops(t, paused, /paused in Lighthouse/))
ok('Pause wins even with the budget off', stops('review-reply', st({ budget: { paused: true, on: false } }), /paused/))
const off = st({ day: 999, month: 9999, hour: { eve: 9999, 'slack-watch': 9999 }, nightly: 999, budget: { on: false } })
ok('budget off → no cap, no reserve, no brake', ['eve', 'slack-watch', 'learn', 'guest-reply-auto'].every(t => goes(t, off)))

console.log('\nthe night shift\'s share (half of the automatic allowance)')
ok('the nightly jobs', [...NIGHTLY].sort().join() === 'eve-brain,eve-correction,learn,probe-judge,probe-writer')
ok('none of them is interactive or exempt', [...NIGHTLY].every(t => !INTERACTIVE.has(t) && !NEVER_CAPPED.has(t) && !WEEKLY_EXEMPT.has(t)))
ok('the allowance is $2.50 by default', nightlyAllowance(DEFAULT_BUDGET) === 2.5)
const night = st({ day: 2.6, nightly: 2.5 })
for (const t of NIGHTLY) ok(`${t} stops once the night has used its share`, stops(t, night, /Nightly learning used its share/))
ok('…and the daytime jobs still have the rest', ['slack-watch', 'sentiment', 'ops-focus', 'guest-reply-auto', 'eve-investigate-auto'].every(t => goes(t, night)))
ok('under its share the night shift runs', [...NIGHTLY].every(t => goes(t, st({ day: 2.4, nightly: 2.49 }))))
ok('daytime spend does not use up the night\'s share', goes('learn', st({ day: 4.9, nightly: 0.2 })))
ok('the automatic cap still stops the night shift first when the day is spent', stops('learn', st({ day: 5, nightly: 0.2 }), /Automatic AI jobs/))
ok('the share follows the automatic cap', nightlyAllowance({ ...DEFAULT_BUDGET, automaticUsd: 8 }) === 4)
ok('a stored budget without the field uses the default share', nightlyAllowance({ automaticUsd: 5, totalUsd: 9, monthUsd: 250, on: true, paused: false, perTaskHour: 40 }) === 2.5)
for (const share of [0, 1, 1.5, -1, NaN]) ok(`share ${share} switches the reserve off`, nightlyAllowance({ ...DEFAULT_BUDGET, nightlyShare: share }) === 0 && goes('learn', st({ day: 4, nightly: 4, budget: { nightlyShare: share } })))
ok('no nightly figure (an old cache entry) → the reserve does not apply', goes('learn', { day: 3, month: 0, hour: {}, budget: { ...DEFAULT_BUDGET } }))
ok('the weekly review is not part of the night shift', goes('eve-review', st({ day: 9, nightly: 9 })))

console.log('\nthe runaway brake')
ok('40 calls in an hour stops a task', stops('slack-watch', st({ hour: { 'slack-watch': 40 } }), /40 AI calls in the last hour/))
ok('…and says it was the brake', decideBudget('slack-watch', st({ hour: { 'slack-watch': 40 } })).brake?.limit === 40 && decideBudget('slack-watch', st({ hour: { 'slack-watch': 41 } })).brake?.count === 41)
ok('39 does not', goes('slack-watch', st({ hour: { 'slack-watch': 39 } })))
ok('one task\'s loop does not stop another', goes('sentiment', st({ hour: { 'slack-watch': 400 } })))
ok('Eve\'s chat gets three times the room', hourLimit('eve', DEFAULT_BUDGET) === 120 && goes('eve', st({ hour: { eve: 119 } })) && stops('eve', st({ hour: { eve: 120 } })))
ok('review replies are not braked', goes('review-reply', st({ hour: { 'review-reply': 4000 } })))
ok('the weekly review is not braked either (as before: it returns ahead of the daily caps and the brake)', goes('eve-review', st({ hour: { 'eve-review': 40 } })))
ok('a cap stop is not reported as the brake', decideBudget('slack-watch', at5).brake === undefined)
ok('a missing perTaskHour falls back to 40', hourLimit('learn', { ...DEFAULT_BUDGET, perTaskHour: 0 }) === 40)

console.log('\nthe order the caps apply')
ok('month before day', stops('eve', st({ day: 9, month: 250 }), /monthly/))
ok('total before automatic', stops('slack-watch', st({ day: 9 }), /daily AI budget/))
ok('automatic before the night\'s share', stops('learn', st({ day: 5, nightly: 5 }), /Automatic AI jobs/))
ok('the share before the brake', stops('learn', st({ day: 3, nightly: 3, hour: { learn: 99 } }), /Nightly learning/))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

ok('translate keeps going past the total cap', goes('translate', at9))

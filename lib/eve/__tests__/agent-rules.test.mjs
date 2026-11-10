// node lib/eve/__tests__/agent-rules.test.mjs
// THE FENCE (lib/eve/agent-rules.ts): rung clamps and the OFF switch, quiet hours and the 7am–8pm ET
// posting window across both daylight-saving changes, the welded actions that never run without a
// person, the money tier, who may say yes, the daily counters and the AI cap. Pure — no network, no
// database. The dates are 2026's changes: clocks go forward Sun 8 Mar (07:00Z), back Sun 1 Nov (06:00Z).
import { readFileSync } from 'node:fs'
const R = await import('../agent-rules.ts')
const {
  ACTION_LIMITS, ACTION_TYPES, NEEDS_HUMAN, needsHumanRefusal, clampRung, modeOf, lower, tierOf, mayApprove, DESK_ACTIONS,
  inQuietHours, quietHoursEnd, inPostWindow, nextPostWindowOpen, POST_WINDOW_ET, etHour, etOffsetMinutes,
  countersFor, bumpCounters, effectiveAiCap, decideGate, gateNeedsCounters, gateNeedsSpend,
} = R
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
const at = iso => new Date(iso)

// A gate input where nothing but the rung and the switch decides: budgets wide open, not quiet.
const QUIET = { start: '22:00', end: '07:00', tz: 'America/New_York' }
const open = (action, over = {}) => ({
  action, storedRung: 4, enabled: true, pilot: null, pilotBuilding: null, usd: undefined,
  budgets: { asksPerDay: 6, actionsPerDay: 40, moneyCeilingUsd: 0 }, counters: { actions: 0, asks: 0 },
  aiCapUsd: 0, aiSpendUsd: 0, ask: false, urgent: false, quiet: false, quietHours: QUIET, ...over,
})

console.log('\nrung clamps')
eq('a rung above the cap is held at the cap', clampRung(4, 2), 2)
eq('a rung below zero is zero', clampRung(-3, 4), 0)
eq('garbage is zero', clampRung('abc', 4), 0)
eq('undefined is zero', clampRung(undefined, 4), 0)
eq('a fraction rounds', clampRung(2.6, 4), 3)
eq('a numeric string is read', clampRung('3', 4), 3)
eq('cap 0 holds everything at 0', clampRung(4, 0), 0)
eq('rung 0 observes', modeOf(0), 'observe'); eq('rung 1 drafts', modeOf(1), 'draft'); eq('rung 2 proposes', modeOf(2), 'propose')
eq('rung 3 acts', modeOf(3), 'act'); eq('rung 4 acts', modeOf(4), 'act')
eq('lower() keeps the smaller', lower('act', 'draft'), 'draft'); eq('lower() never raises', lower('observe', 'draft'), 'observe')
ok('sixteen actions, each with a default inside its cap', ACTION_TYPES.length === 16 && ACTION_TYPES.every(a => ACTION_LIMITS[a].def <= ACTION_LIMITS[a].cap))
for (const [a, cap] of [['guest_reply_send', 2], ['guesty_write', 2], ['email_send', 2], ['door_code_release', 2], ['task_cancel', 2], ['calendar_block', 0], ['recommendation', 1], ['memory_rule', 1]]) {
  eq(`${a} is capped at ${cap}`, ACTION_LIMITS[a].cap, cap)
}
for (const a of ACTION_TYPES) {
  const g = decideGate(open(a))
  ok(`${a}: a stored rung of 4 never beats the cap`, g.rung <= ACTION_LIMITS[a].cap, `rung ${g.rung}`)
  ok(`${a}: acts only if its cap allows acting`, (g.mode === 'act') === (ACTION_LIMITS[a].cap >= 3), g.mode)
}
eq('no stored rung → the default', decideGate(open('slack_post', { storedRung: undefined })).rung, 3)
eq('a stored rung of 0 is respected (not replaced by the default)', decideGate(open('slack_post', { storedRung: 0 })).mode, 'observe')
eq('calendar_block observes whatever is stored', decideGate(open('calendar_block')).mode, 'observe')

console.log('\nthe OFF switch')
for (const a of ACTION_TYPES) {
  const g = decideGate(open(a, { enabled: false }))
  ok(`${a}: OFF never acts, proposes or defers`, g.mode === 'draft' || g.mode === 'observe', g.mode)
  ok(`${a}: OFF is never ok`, g.ok === false && g.needsApproval === false)
}
ok('OFF says so', /agent mode is OFF/.test(decideGate(open('slack_post', { enabled: false })).reason))
eq('OFF + a pilot building still does not act', decideGate(open('task_create', { enabled: false, pilot: 'Pilot One', pilotBuilding: 'Rustic' })).mode, 'draft')
eq('OFF + urgent still does not act', decideGate(open('slack_post', { enabled: false, urgent: true })).mode, 'draft')
eq('OFF at rung 0 stays observe (never raised to draft)', decideGate(open('slack_post', { enabled: false, storedRung: 0 })).mode, 'observe')
eq('her notebook still drafts when OFF', decideGate(open('memory_rule', { enabled: false })).mode, 'draft')
ok('…and is not labelled OFF', !/OFF/.test(decideGate(open('memory_rule', { enabled: false })).reason))
eq('ON: slack_post at 3 acts', decideGate(open('slack_post', { storedRung: 3 })).mode, 'act')
eq('ON: task_create at 2 proposes', decideGate(open('task_create', { storedRung: 2 })).mode, 'propose')

console.log('\nthe welded actions never run without a person')
ok('every action capped at propose or below that leaves the app is on NEEDS_HUMAN', ACTION_TYPES.filter(a => ACTION_LIMITS[a].cap === 2 || ACTION_LIMITS[a].cap === 0).every(a => NEEDS_HUMAN.includes(a)))
ok('…and nothing else is', NEEDS_HUMAN.every(a => ACTION_LIMITS[a].cap <= 2))
for (const a of NEEDS_HUMAN) {
  for (const human of [false, undefined, null, 0, '', 'true', 1]) ok(`${a}: refused with human=${JSON.stringify(human)}`, !!needsHumanRefusal(a, human))
  eq(`${a}: runs with human=true`, needsHumanRefusal(a, true), null)
  // No setting, pilot, urgency or budget can make the gate answer "act" for it.
  for (const over of [{}, { pilot: 'Pilot One', pilotBuilding: 'Rustic' }, { urgent: true }, { storedRung: 99 }, { usd: 0 }, { ask: true }]) {
    ok(`${a}: the gate never says act (${JSON.stringify(over)})`, decideGate(open(a, over)).mode !== 'act' && decideGate(open(a, over)).ok === false)
  }
}
for (const a of ['slack_post', 'task_create', 'task_note', 'task_assign', 'guest_reply_draft', 'guest_notice_send', 'email_draft', 'telegram_ask', 'memory_rule', 'recommendation']) {
  eq(`${a}: not welded`, needsHumanRefusal(a, false), null)
}
ok('the refusal says a person has to approve', /person has to approve/.test(needsHumanRefusal('guest_reply_send', false).error))
{ // The executor and the action table really use these (a guard against a second copy drifting).
  const exec = readFileSync(new URL('../executors.ts', import.meta.url), 'utf8')
  ok('runExecutor asks needsHumanRefusal with ctx.human', exec.includes('needsHumanRefusal(action, ctx.human)') && /if \(refused\) return \{ ok: false/.test(exec))
  ok('executors.ts keeps no list of its own', !/const NEEDS_HUMAN\b/.test(exec))
  const mode = readFileSync(new URL('../agent-mode.ts', import.meta.url), 'utf8')
  const table = mode.slice(mode.indexOf('export const ACTIONS: ActionDef[] = ['), mode.indexOf('export const ACTION_KEYS'))
  ok('every row of ACTIONS takes its limits from ACTION_LIMITS', ACTION_TYPES.every(a => table.includes(`...ACTION_LIMITS.${a},`)) && !/\bcap: \d/.test(table) && !/\bdef: \d/.test(table))
  const gate = readFileSync(new URL('../room-gate.ts', import.meta.url), 'utf8')
  ok('room-gate.ts holds the same posting window', gate.includes(`POST_WINDOW_ET = { start: ${POST_WINDOW_ET.start}, end: ${POST_WINDOW_ET.end} }`))
}

console.log('\nmoney ceiling and daily budgets')
eq('money over the ceiling is proposed, not done', decideGate(open('task_create', { usd: 50 })).mode, 'propose')
eq('money under the ceiling acts', decideGate(open('task_create', { usd: 50, budgets: { asksPerDay: 6, actionsPerDay: 40, moneyCeilingUsd: 100 } })).mode, 'act')
eq('actions spent → propose', decideGate(open('slack_post', { counters: { actions: 40, asks: 0 } })).mode, 'propose')
eq('one action left → act', decideGate(open('slack_post', { counters: { actions: 39, asks: 0 } })).mode, 'act')
eq('AI spend at the cap → propose', decideGate(open('slack_post', { aiCapUsd: 9, aiSpendUsd: 9 })).mode, 'propose')
eq('AI spend under the cap → act', decideGate(open('slack_post', { aiCapUsd: 9, aiSpendUsd: 8.99 })).mode, 'act')
eq('no AI cap (0) → spend never stops her', decideGate(open('slack_post', { aiCapUsd: 0, aiSpendUsd: 500 })).mode, 'act')
eq('asks spent: a proposal that would ping becomes a draft', decideGate(open('task_create', { storedRung: 2, ask: true, counters: { actions: 0, asks: 6 } })).mode, 'draft')
eq('asks spent: an act that pings nobody still acts', decideGate(open('slack_post', { ask: true, counters: { actions: 0, asks: 6 } })).mode, 'act')
eq('asks spent: a proposal without ask:true still proposes', decideGate(open('task_create', { storedRung: 2, counters: { actions: 0, asks: 6 } })).mode, 'propose')
eq('actions AND asks spent: act → propose → draft', decideGate(open('slack_post', { ask: true, counters: { actions: 40, asks: 6 } })).mode, 'draft')
eq('asks spent: a Telegram ask is drafted', decideGate(open('telegram_ask', { storedRung: 2, counters: { actions: 0, asks: 6 } })).mode, 'draft')
ok('counters are read only for act / propose', gateNeedsCounters('act') && gateNeedsCounters('propose') && !gateNeedsCounters('draft') && !gateNeedsCounters('observe'))
const B = { asksPerDay: 6, actionsPerDay: 40, moneyCeilingUsd: 0 }
ok('the AI ledger is read only while the answer is still act', gateNeedsSpend('act', { budgets: B, counters: { actions: 0, asks: 0 }, aiCapUsd: 15 }) && !gateNeedsSpend('propose', { budgets: B, counters: { actions: 0, asks: 0 }, aiCapUsd: 15 }) && !gateNeedsSpend('act', { budgets: B, counters: { actions: 40, asks: 0 }, aiCapUsd: 15 }) && !gateNeedsSpend('act', { budgets: B, counters: { actions: 0, asks: 0 }, aiCapUsd: 0 }))

console.log('\nthe agent AI cap is the one she can reach')
eq('her 15 against an app-wide 9 is 9', effectiveAiCap(15, { on: true, totalUsd: 9 }), 9)
eq('her 4 against an app-wide 9 is 4', effectiveAiCap(4, { on: true, totalUsd: 9 }), 4)
eq('app-wide budget off → her own number', effectiveAiCap(15, { on: false, totalUsd: 9 }), 15)
eq('app-wide budget unreadable → her own number', effectiveAiCap(15, null), 15)
eq('0 = no cap of her own', effectiveAiCap(0, { on: true, totalUsd: 9 }), 0)
eq('garbage = no cap', effectiveAiCap(NaN, { on: true, totalUsd: 9 }), 0)

console.log('\nquiet hours 22:00–07:00 ET, across both clock changes')
const S = { quietHours: QUIET }
const quietCases = [
  // Sat 7 Mar 2026 — still EST (UTC-5)
  ['2026-03-07T11:59:00Z', true, '6:59am EST'], ['2026-03-07T12:00:00Z', false, '7:00am EST'],
  ['2026-03-08T02:59:00Z', false, '9:59pm EST Sat'], ['2026-03-08T03:00:00Z', true, '10:00pm EST Sat'],
  // Sun 8 Mar 2026 — 2am EST becomes 3am EDT at 07:00Z
  ['2026-03-08T06:59:00Z', true, '1:59am EST'], ['2026-03-08T07:00:00Z', true, '3:00am EDT'],
  ['2026-03-08T10:59:00Z', true, '6:59am EDT'], ['2026-03-08T11:00:00Z', false, '7:00am EDT (an hour earlier in UTC than Saturday)'],
  ['2026-03-09T01:59:00Z', false, '9:59pm EDT Sun'], ['2026-03-09T02:00:00Z', true, '10:00pm EDT Sun'],
  // Sat 31 Oct 2026 — still EDT (UTC-4)
  ['2026-10-31T10:59:00Z', true, '6:59am EDT'], ['2026-10-31T11:00:00Z', false, '7:00am EDT'],
  ['2026-11-01T01:59:00Z', false, '9:59pm EDT Sat'], ['2026-11-01T02:00:00Z', true, '10:00pm EDT Sat'],
  // Sun 1 Nov 2026 — 2am EDT becomes 1am EST at 06:00Z; 1:30am happens twice
  ['2026-11-01T05:30:00Z', true, '1:30am EDT (first time)'], ['2026-11-01T06:30:00Z', true, '1:30am EST (second time)'],
  ['2026-11-01T11:00:00Z', true, '6:00am EST (would have been 7am on Saturday)'], ['2026-11-01T11:59:00Z', true, '6:59am EST'],
  ['2026-11-01T12:00:00Z', false, '7:00am EST'],
  ['2026-11-02T02:59:00Z', false, '9:59pm EST Sun'], ['2026-11-02T03:00:00Z', true, '10:00pm EST Sun'],
]
for (const [iso, want, label] of quietCases) eq(`${label} → ${want ? 'quiet' : 'not quiet'}`, inQuietHours(S, at(iso)), want)
eq('start = end means no quiet hours', inQuietHours({ quietHours: { start: '07:00', end: '07:00', tz: 'America/New_York' } }, at('2026-03-08T07:00:00Z')), false)
eq('a daytime window that does not wrap', inQuietHours({ quietHours: { start: '12:00', end: '13:00', tz: 'America/New_York' } }, at('2026-07-01T16:30:00Z')), true)
eq('an act in quiet hours is held', decideGate(open('slack_post', { quiet: true })).mode, 'deferred')
eq('…unless a person asked for it now', decideGate(open('slack_post', { quiet: true, urgent: true })).mode, 'act')
eq('a proposal in quiet hours is still a proposal', decideGate(open('task_create', { storedRung: 2, quiet: true })).mode, 'propose')
eq('a Telegram ask at propose is held in quiet hours', decideGate(open('telegram_ask', { storedRung: 2, quiet: true })).mode, 'deferred')
eq('a welded action in quiet hours is never held-then-run', decideGate(open('guest_reply_send', { quiet: true })).mode, 'propose')
ok('held is not ok', decideGate(open('slack_post', { quiet: true })).ok === false)
// When the hold ends: 7am ET on the right side of each change, whatever the server's own time zone.
eq('held Sat night before spring-forward → 7am EDT Sunday (11:00Z)', quietHoursEnd(S, at('2026-03-08T03:30:00Z')), '2026-03-08T11:00:00.000Z')
eq('held Sat night before fall-back → 7am EST Sunday (12:00Z)', quietHoursEnd(S, at('2026-11-01T03:30:00Z')), '2026-11-01T12:00:00.000Z')
eq('held at 2am on an ordinary summer night → 7am EDT the same day', quietHoursEnd(S, at('2026-07-15T06:00:00Z')), '2026-07-15T11:00:00.000Z')
eq('held at 11pm on an ordinary winter night → 7am EST the next day', quietHoursEnd(S, at('2026-01-15T04:00:00Z')), '2026-01-15T12:00:00.000Z')
eq('outside quiet hours the hold ends now', quietHoursEnd(S, at('2026-07-15T15:00:00Z')), '2026-07-15T15:00:00.000Z')
eq('offset in winter', etOffsetMinutes(at('2026-01-15T12:00:00Z')), -300); eq('offset in summer', etOffsetMinutes(at('2026-07-15T12:00:00Z')), -240)

console.log('\nthe 7am–8pm ET posting window, across both clock changes')
eq('the window is 7 to 20', `${POST_WINDOW_ET.start}-${POST_WINDOW_ET.end}`, '7-20')
const windowCases = [
  ['2026-03-07T11:59:00Z', false, 'Sat 6:59am EST'], ['2026-03-07T12:00:00Z', true, 'Sat 7:00am EST'],
  ['2026-03-08T00:59:00Z', true, 'Sat 7:59pm EST'], ['2026-03-08T01:00:00Z', false, 'Sat 8:00pm EST'],
  ['2026-03-08T07:30:00Z', false, 'Sun 3:30am EDT (just after the change)'],
  ['2026-03-08T10:59:00Z', false, 'Sun 6:59am EDT'], ['2026-03-08T11:00:00Z', true, 'Sun 7:00am EDT'],
  ['2026-03-08T23:59:00Z', true, 'Sun 7:59pm EDT'], ['2026-03-09T00:00:00Z', false, 'Sun 8:00pm EDT'],
  ['2026-10-31T10:59:00Z', false, 'Sat 6:59am EDT'], ['2026-10-31T11:00:00Z', true, 'Sat 7:00am EDT'],
  ['2026-10-31T23:59:00Z', true, 'Sat 7:59pm EDT'], ['2026-11-01T00:00:00Z', false, 'Sat 8:00pm EDT'],
  ['2026-11-01T05:30:00Z', false, 'Sun 1:30am EDT'], ['2026-11-01T06:30:00Z', false, 'Sun 1:30am EST'],
  ['2026-11-01T11:00:00Z', false, 'Sun 6:00am EST (7am the day before)'], ['2026-11-01T11:59:00Z', false, 'Sun 6:59am EST'],
  ['2026-11-01T12:00:00Z', true, 'Sun 7:00am EST'],
  ['2026-11-02T00:59:00Z', true, 'Sun 7:59pm EST'], ['2026-11-02T01:00:00Z', false, 'Sun 8:00pm EST'],
]
for (const [iso, want, label] of windowCases) eq(`${label} → ${want ? 'open' : 'closed'}`, inPostWindow(at(iso)), want)
eq('midnight ET reads as hour 0, never 24', etHour(at('2026-07-15T04:00:00Z')), 0)
eq('closed Sat evening before spring-forward → opens 7am EDT (11:00Z)', nextPostWindowOpen(at('2026-03-08T02:00:00Z')), '2026-03-08T11:00:00.000Z')
eq('closed Sat evening before fall-back → opens 7am EST (12:00Z)', nextPostWindowOpen(at('2026-11-01T01:30:00Z')), '2026-11-01T12:00:00.000Z')
eq('already open → the next five-minute mark', nextPostWindowOpen(at('2026-07-15T15:02:00Z')), '2026-07-15T15:05:00.000Z')
ok('the instant it gives is inside the window', inPostWindow(at(nextPostWindowOpen(at('2026-11-01T06:30:00Z')))) && inPostWindow(at(nextPostWindowOpen(at('2026-03-08T06:59:00Z')))))

console.log('\nthe money tier')
for (const a of ['task_note', 'task_create', 'task_assign', 'guest_reply_draft', 'guest_reply_send', 'guest_notice_send']) eq(`${a} with no money is the desk's`, tierOf(a, { summary: 'reply to a guest who has waited 9h' }), 'desk')
for (const a of ['slack_post', 'telegram_ask', 'email_draft', 'email_send', 'task_cancel', 'door_code_release', 'guesty_write', 'calendar_block', 'recommendation', 'memory_rule', 'made_up', '']) eq(`${JSON.stringify(a)} is the owner's`, tierOf(a, {}), 'owner')
ok('the desk set is exactly six actions', DESK_ACTIONS.size === 6)
for (const w of ['refund the cleaning fee', 'Refunded already', 'cancel the reservation', 'guest asked about cancellation', 'offer a 10% discount', 'DISCOUNT code', 'comp a night', 'we will comp.', 'a $50 credit', 'credit card on file']) {
  eq(`"${w}" makes a desk action the owner's`, tierOf('guest_reply_send', { summary: w }), 'owner')
}
for (const w of ['the AC issue is complete', 'a complimentary bottle is not money by this rule', 'compare the two tasks', 'computer in the office', 'guest waited 9h', '']) {
  eq(`"${w}" stays with the desk`, tierOf('task_create', { summary: w }), 'desk')
}
eq('dollars attached → owner', tierOf('task_create', { usd: 0.01, summary: 'buy a filter' }), 'owner')
eq('usd as a string → owner', tierOf('task_create', { usd: '25' }), 'owner')
eq('zero dollars → desk', tierOf('task_create', { usd: 0, summary: 'change the filter' }), 'desk')
eq('no payload → desk for a desk action', tierOf('task_note'), 'desk')
eq('only the summary is read, not other fields', tierOf('guest_reply_send', { body: 'here is your refund', summary: 'reply to Ana' }), 'desk')

console.log('\nwho may say yes')
const A = { approvers: ['Jon@Stay-Hospitality.com '], deskApprovals: true }
eq('an approver, any case or spacing', mayApprove(A, 'guesty_write', {}, ' JON@stay-hospitality.com', false), 'approver')
eq('a superadmin', mayApprove(A, 'guesty_write', {}, 'someone@x.com', true), 'approver')
eq('a team member on a desk action', mayApprove(A, 'task_create', { summary: 'make the task' }, 'ana@x.com', false), 'desk')
eq('a team member on an owner action', mayApprove(A, 'guesty_write', {}, 'ana@x.com', false), null)
eq('a team member on a desk action that reads as money', mayApprove(A, 'guest_reply_send', { summary: 'refund one night' }, 'ana@x.com', false), null)
eq('desk approvals switched off', mayApprove({ ...A, deskApprovals: false }, 'task_create', {}, 'ana@x.com', false), null)
eq('nobody (no email) on a desk action', mayApprove(A, 'task_create', {}, '', false), null)
eq('a name that is not an email', mayApprove(A, 'task_create', {}, 'ana', false), null)
eq('an empty approver list keeps the old rule (anyone the route let in)', mayApprove({ approvers: [], deskApprovals: false }, 'guesty_write', {}, 'ana@x.com', false), 'approver')

console.log('\nthe daily counters')
const c0 = countersFor(JSON.stringify({ date: '2026-11-10', actions: 39, asks: 2, byAction: { slack_post: 30 } }), '2026-11-10')
eq('a stored JSON string is read', c0.actions, 39)
const c1 = bumpCounters(c0, 'slack_post', 'action'), c2 = bumpCounters(c0, 'telegram_ask', 'ask')
ok('an action adds one action and one to its own line', c1.actions === 40 && c1.asks === 2 && c1.byAction.slack_post === 31)
ok('an ask adds one ask', c2.actions === 39 && c2.asks === 3 && c2.byAction.telegram_ask === 1)
ok('the input is never mutated (a lost write can be retried from a fresh read)', c0.actions === 39 && c0.asks === 2 && c0.byAction.slack_post === 30 && !('telegram_ask' in c0.byAction))
ok('yesterday\'s row is a fresh day', countersFor({ date: '2026-11-09', actions: 40, asks: 6, byAction: { x: 1 } }, '2026-11-10').actions === 0)
ok('no row is a fresh day', countersFor(null, '2026-11-10').asks === 0 && countersFor(undefined, '2026-11-10').date === '2026-11-10')
ok('garbage is a fresh day, never a throw', countersFor('{not json', '2026-11-10').actions === 0 && countersFor(42, '2026-11-10').actions === 0)
{ // Two writers from the same read: with compare-and-swap the second re-reads, so the total is 2, not 1.
  let row = { v: c0, stamp: 1 }
  const tryWrite = (readStamp, next) => { if (row.stamp !== readStamp) return false; row = { v: next, stamp: row.stamp + 1 }; return true }
  const r1 = { ...row }, r2 = { ...row }
  ok('first writer lands', tryWrite(r1.stamp, bumpCounters(r1.v, 'slack_post', 'action')))
  ok('second writer, same read, is refused', !tryWrite(r2.stamp, bumpCounters(r2.v, 'slack_post', 'action')))
  const r3 = { ...row }
  ok('…and lands after re-reading', tryWrite(r3.stamp, bumpCounters(r3.v, 'slack_post', 'action')) && row.v.actions === 41)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

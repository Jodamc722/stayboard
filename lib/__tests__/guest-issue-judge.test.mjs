// node lib/__tests__/guest-issue-judge.test.mjs — WHAT POSTS TO CUSTOMER CARE (Eve audit 2026-10-10).
//
// The watch shipped 2026-10-07 posted ~9–14 "Guest issue" alerts a day, each tagging three people.
// Most were ordinary calls: check-in instructions, an early check-in request, a post-checkout
// feedback call. And Capri 110 — a door code that worked after troubleshooting — went to two rooms
// as a Safety matter because "lock is" matched "the smart lock is not accepting the code".
const J = await import('../guest-issue-judge.ts')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (x ? '  ' + x : '')) } }
const sev = (issues, ctx, sentiment = 'fine', followUp = false) => J.judgeIssue(issues, ctx, sentiment, { followUp })

console.log('\nguest issue judgement')
// Routine calls never alert.
ok('check-in instructions → watch', sev(['Guest asked for check-in instructions'], 'Guest called about check-in instructions; CCS sent them.').severity === 'watch')
ok('early check-in request → watch', sev(['Early check-in request'], 'Asked for a 2pm early check-in, told it depends on the clean.', 'unhappy').severity === 'watch')
ok('feedback call → watch', sev(['Post-checkout feedback call'], 'Routine post-checkout feedback call, guest happy.', 'happy').severity === 'watch')
ok('nothing named, unhappy → watch', sev([], 'Guest unhappy about the cancellation policy.', 'unhappy').severity === 'watch')
// Real problems alert.
ok('no hot water → issue', sev(['No hot water in the shower'], 'Guest reports no hot water since last night.', 'unhappy').severity === 'issue')
ok('construction noise on a call, unhappy, nothing concrete → watch', sev(['Construction noise from the unit above'], 'Guest unhappy, could not sleep.', 'unhappy').severity === 'watch')
ok('the same in writing → issue', J.judgeIssue(['Construction noise from the unit above'], 'Guest unhappy, could not sleep.', 'unhappy', { followUp: true, sentimentAlone: true }).severity === 'issue')
ok('early check-in refused, guest frustrated, on a call → watch', sev(['Early check-in not available', 'Guest frustrated'], 'Asked for early check-in from the cruise port; told 4pm.', 'unhappy').severity === 'watch')
ok('routine + concrete → issue', sev(['Early check-in request', 'AC not working'], 'Asked for early check-in; AC not working.', 'fine').severity === 'issue')
// Settled on the call: filed quietly.
const capri = sev(['Door code not working initially'], 'Guest could not get in; the code worked after troubleshooting with CCS. No further action needed.', 'fine', false)
ok('Capri 110 is not a safety matter', capri.severity === 'issue', capri.severity)
ok('Capri 110 is quiet', capri.quiet === true)
ok('settled but follow-up owed is not quiet', sev(['Door code not working initially'], 'The code worked after troubleshooting; CCS promised to call back about the fee.', 'fine', true).quiet === false)
// Safety still escalates.
const jenna = sev(['Door lock malfunction—will not lock from inside or outside', 'Attempted unauthorized entry from neighboring unit'], 'Somebody tried her door handle and the lock would not lock at all.', 'unhappy')
ok('Jenna → security', jenna.severity === 'security', jenna.severity)
ok('smart lock mention alone is not security', sev(['Smart lock is not accepting the code'], 'Code re-sent, guest got in.', 'fine').severity !== 'security')
ok('afraid in the summary → security', sev([], 'Guest is afraid: a stranger was outside the door at 2am.', 'unhappy').severity === 'security')
ok('fell asleep is not an injury', sev(['Guest fell asleep and missed the call'], 'Routine.', 'fine').severity !== 'security')
ok('fireplace is not a fire', sev(['Asked how the fireplace works'], 'Routine.', 'fine').severity === 'watch')
// NEVER SAFETY ON A WELCOME OR FEEDBACK CALL (Jon, 2026-11-05).
const wc = J.judgeIssue(['Smoke detector chirping in the bedroom'], 'Welcome call; guest asked where the fire extinguisher is.', 'fine', { callKind: 'welcome' })
ok('welcome call is never safety', wc.severity !== 'security', wc.severity)
const pc = J.judgeIssue(['Guest felt unsafe walking to the garage at night'], 'Post-checkout feedback call; guest said they felt unsafe in the garage.', 'unhappy', { callKind: 'post_checkout' })
ok('post-checkout call is never safety', pc.severity !== 'security', pc.severity)
ok('the same on a stay call is safety', J.judgeIssue(['Guest felt unsafe walking to the garage at night'], 'Guest felt unsafe.', 'unhappy', { callKind: 'stay' }).severity === 'security')
ok('welcome-call category is not Safety', J.categoryFor('smoke detector chirping', { noSafety: true }) !== 'Safety/Security Concern')
// Which tier reaches Slack.
ok('safety → safety tier', J.alertTier({ severity: 'security', kind: 'call' }) === 'safety')
ok('issue, guest waiting → waiting', J.alertTier({ severity: 'issue', kind: 'message', waiting: true }) === 'waiting')
ok('issue, nobody waiting → fyi', J.alertTier({ severity: 'issue', kind: 'message', waiting: false }) === 'fyi')
const nowT = Date.parse('2026-11-05T15:00:00Z')
ok('guest wrote last, an hour ago → waiting', J.guestWaitingNow({ kind: 'message', lastGuestAt: '2026-11-05T14:00:00Z', lastMessageAt: '2026-11-05T14:00:00Z' }, nowT))
ok('we answered after → not waiting', !J.guestWaitingNow({ kind: 'message', lastGuestAt: '2026-11-05T14:00:00Z', lastMessageAt: '2026-11-05T14:10:00Z' }, nowT))
ok('welcome call with follow-up → not waiting', !J.guestWaitingNow({ kind: 'call', callAt: '2026-11-05T14:30:00Z', followUp: true, callKind: 'welcome' }, nowT))
ok('stay call owing a follow-up → waiting', J.guestWaitingNow({ kind: 'call', callAt: '2026-11-05T14:30:00Z', followUp: true, callKind: 'stay' }, nowT))

// THE SAME NOTE, ONCE (2026-11-20: 100 glitches carried the same "Also heard" line 40-odd times).
{
  const line = 'Also heard (message, Nov 18, 6:10 PM): Bedside lamp not working\nhttps://lighthouse-stay.vercel.app/inbox?c=6ab6e481'
  const other = 'Also heard (call, Nov 19, 9:02 AM): AC is leaking\nhttps://lighthouse-stay.vercel.app/calls?id=9'
  const typed = 'Guest says the lamp by the bed is out.\n\nTech went by at 4.'
  const messy = [typed, line, line, other, line, 'A note Karla typed', line, line.slice(0, 40)].join('\n\n')
  const clean = J.dropRepeatedNotes(messy)
  ok('repeats dropped, order kept', clean === [typed, line, other, 'A note Karla typed'].join('\n\n'), clean)
  ok('already clean is untouched', J.dropRepeatedNotes(clean) === clean)
  ok('typed text that repeats is left alone', J.dropRepeatedNotes('same\n\nsame') === 'same\n\nsame')
  ok('empty', J.dropRepeatedNotes('') === '')
  const h = [{ action: 'created', detail: 'auto-filed from thread:1' }, { action: 'note', detail: 'another report on this stay merged from thread:2' }, { action: 'note', detail: 'another report on this stay merged from thread:2' }, { action: 'note', detail: 'a person wrote this' }, { action: 'note', detail: 'a person wrote this' }, { action: 'note', detail: 'another report on this stay merged from call:3' }]
  ok('history: one merge note per source, typed notes kept', J.dropRepeatedHistory(h).length === 5)
}

// SAFETY WORDS THAT ARE NOT A SAFETY MATTER (Jon, 2026-11-26) — thirty days of real alerts, replayed.
const msg = (issue, ctx = '') => J.judgeIssue([issue], ctx, 'unhappy', { followUp: true, sentimentAlone: true }).severity
const call = (issues, ctx = '') => J.judgeIssue(issues, ctx, 'unhappy', { followUp: true }).severity
ok('smoke odor charge dispute is not safety', msg('smoke odor charge dispute') === 'issue', msg('smoke odor charge dispute'))
ok('smoke odor and damage charges is not safety', msg('smoke odor and damage charges') !== 'security')
ok('smoke smell in unit is not safety', msg('smoke smell in unit') !== 'security')
ok('bathroom smells of smoke is not safety', call(['shower leaks onto bathroom floor', 'bathroom smells of smoke']) !== 'security')
ok('cigarette smoke drifting in is not safety', call(['smoke (marijuana and cigarette) drifting into unit from people outside near AC unit']) !== 'security')
ok('Smoke odor from neighboring guest is not safety', msg('Smoke odor from neighboring guest and broken coffee maker') !== 'security')
ok('flooded parking lot is not safety', msg('flooded parking lot') !== 'security', msg('flooded parking lot'))
ok('Flooded parking is not safety', msg('Flooded parking') !== 'security')
ok('front parking lot flooded after rain is not safety', call(['keypad entry did not work at first', 'front parking lot flooded after rain']) !== 'security')
ok('worried about flooding is not safety', call(['guest worried about flooding and weather warnings in the area']) !== 'security')
ok('refund over flooding concerns is not safety', msg('Early departure refund request due to flooding concerns') !== 'security')
ok('fire alarm inspection is not safety', call(['mandatory fire alarm inspection today, possibly needing unit entry']) !== 'security')
ok('confused by the deadbolt is not safety', call(['keypad code did not open the door on first attempts', 'guest was confused by the deadbolt and no key was present']) !== 'security')
ok('deadbolt left latched is not safety', call(['front door deadbolt left latched, preventing entry']) !== 'security')
ok('an address 911 is not a 911 call', call(['passcode reported not working at back door of 115; guest later said it works'], 'Guest called from the Capri 115/116 unit at 911 N Federal Hwy.') !== 'security')
ok('threatened a bad review is not safety', call(['dirty sofa', 'hair in shower'], 'Guest threatened to leave a one star review and dispute the charge.') !== 'security')
ok('unsafe to leave towels outside is not safety', call(['front desk reportedly will not accept items; unsafe to leave outside the door']) !== 'security')
ok('neighborhood looks unsafe is not safety', call(['guest feels the neighborhood is unsafe or undesirable']) !== 'security')
ok('exterior looks unsafe is not safety', call(['no parking available', 'guest says exterior looks run-down and unsafe']) !== 'security')
ok('lock failed, locked out is access, not safety', call(['electronic lock failed, guest locked out for about two hours']) !== 'security')
ok("I'm afraid we can't is not safety", call(['Refund request'], "I'm afraid that is not what we booked.") !== 'security')
// …and what still is.
ok('ceiling leak flooding unit → security', msg('Ceiling leak flooding unit') === 'security')
ok('smoke in the unit → security', call(['smoke coming from the oven'], 'There is smoke in the unit.') === 'security')
ok('fire alarm going off repeatedly → security', msg('fire alarm going off repeatedly') === 'security')
ok('called 911 → security', call(['Guest called 911 after a break-in attempt']) === 'security')
ok('feels unsafe, door unlocked → security', call(['guest felt unsafe after finding door unlocked']) === 'security')
ok('unlocked connecting door → still flagged', call(['Connecting door will not lock']) === 'security')
ok('possible gas leak → security', call(['AC problem in original unit (possible gas leak)']) === 'security')
ok('threatened the housekeeper → security', call(['Guest upset about the clean'], 'Guest threatened the housekeeper at the door.') === 'security')
ok('smoke odor category is not Safety', J.categoryFor('smoke odor charge dispute') !== 'Safety/Security Concern')
ok('flooded parking category is not Safety', J.categoryFor('flooded parking lot') !== 'Safety/Security Concern')

console.log(`  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

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
ok('construction noise, unhappy → issue', sev(['Construction noise from the unit above'], 'Guest unhappy, could not sleep.', 'unhappy').severity === 'issue')
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

console.log(`  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

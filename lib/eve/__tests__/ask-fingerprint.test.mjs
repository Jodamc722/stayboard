// node lib/eve/__tests__/ask-fingerprint.test.mjs
// ONE ASK PER THING (2026-10-02): the same ask with its counters ticked must fingerprint the same;
// a different guest, unit or action must not.
import assert from 'node:assert/strict'
const { proposalFingerprint: fp } = await import('../ask-fingerprint.ts')

assert.equal(fp('slack_post', 'The guest spoke last 57h ago and nobody has answered.'), fp('slack_post', 'The guest spoke last 65h ago and nobody has answered.'))
assert.equal(fp('task_create', 'PM audit is due 2026-07-03 on Pelican 6 - Studio, 88 days over.'), fp('task_create', 'PM audit is due 2026-07-03 on Pelican 6 - Studio, 94 days over.'))
assert.notEqual(fp('task_create', 'PM audit is due 2026-07-03 on Pelican 6 - Studio, 88 days over.'), fp('task_create', 'PM audit is due 2026-07-03 on Pelican 5 - Studio, 88 days over.'))
assert.equal(fp('slack_post', 'Remind all field staff to announce clocking in, at 7:30 AM'), fp('slack_post', 'Remind all field staff to announce clocking in, at 8:15am'))
assert.notEqual(fp('slack_post', 'Eden 1205 — AC leaking'), fp('task_create', 'Eden 1205 — AC leaking'))
assert.notEqual(fp('slack_post', 'Eden 1205 — AC leaking'), fp('slack_post', 'Eden 1206 — AC leaking'))
assert.equal(fp('slack_post', 'Refund $1,200.00 to Jake'), fp('slack_post', 'Refund $1,250 to Jake'))
// Eve audit 2026-10-07: a ticking count is the same ask; a unit number is not.
assert.equal(fp('email_draft', 'open Guesty channel settings — 129 listings off a major channel (Elser 4306)'), fp('email_draft', 'open Guesty channel settings — 128 listings off a major channel (Elser 4306)'))
assert.equal(fp('slack_post', 'morning roll-up in #vr-eve (8 open)'), fp('slack_post', 'morning roll-up in #vr-eve (15 open)'))
assert.notEqual(fp('task_create', 'create "A/C filter change — Hendricks 1 - 1BR"'), fp('task_create', 'create "A/C filter change — Hendricks 6 - 1BR"'))
console.log('ask-fingerprint: ok')

// node --test lib/brain/__tests__/repeat-rule.test.mjs
// THE BRAIN'S REPEAT RULE (lib/brain/repeat-rule.ts) and the part words it rests on
// (lib/task-categories.ts subsystemOf). Pure — no database. Both files have no imports, and
// node >= 22.18 strips their types itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { repeatVerdict } = await import('../repeat-rule.ts')
const { subsystemOf } = await import('../../task-categories.ts')

const D = 86400_000
const T0 = Date.parse('2026-08-01T12:00:00Z')
const ev = (id, day, { source = 'bz_task', system = 'hvac', part = null, closedDay = null } = {}) => ({
  id, source, system, part, openedAt: T0 + day * D, closedAt: closedDay == null ? null : T0 + closedDay * D,
})

test('same named part within 90 days is a repeat', () => {
  const a = ev('a', 0, { part: 'thermostat', closedDay: 1 })
  const b = ev('b', 70, { part: 'thermostat' })
  assert.deepEqual(repeatVerdict(b, [a]), { loose: 1, hit: 'a', why: 'same_part' })
})

test('two different named parts are two jobs, even right after a fix', () => {
  const a = ev('a', 0, { system: 'electrical', part: 'light', closedDay: 1 })
  const b = ev('b', 10, { system: 'electrical', part: 'outlet' })
  const v = repeatVerdict(b, [a])
  assert.equal(v.hit, null)
  assert.equal(v.loose, 1, 'the loose count still sees it')
})

test('back within 30 days of a closed fix, part not named on one side, is a repeat', () => {
  const a = ev('a', 0, { part: 'not_cooling', closedDay: 2 })
  const b = ev('b', 20, { part: null })
  assert.equal(repeatVerdict(b, [a]).why, 'fix_did_not_hold')
})

test('outside 30 days of the fix with no part named is not a repeat', () => {
  const a = ev('a', 0, { closedDay: 2 })
  const b = ev('b', 40)
  assert.equal(repeatVerdict(b, [a]).hit, null)
})

test('two unnamed parts are never "the same part"', () => {
  const a = ev('a', 0)            // still open
  const b = ev('b', 50)
  assert.equal(repeatVerdict(b, [a]).hit, null)
})

test('a glitch and a separate task for the same incident are not a repeat, open or closed', () => {
  const g = ev('g', 0, { source: 'glitch', part: 'drain_leak', closedDay: 0.1 })
  const t = ev('t', 0.5, { source: 'bz_task', part: 'drain_leak' })
  assert.equal(repeatVerdict(t, [g]).hit, null)
  const g2 = ev('g2', 0, { source: 'glitch', part: 'drain_leak' })       // still open
  const t2 = ev('t2', 1, { source: 'glitch', part: 'drain_leak' })
  assert.equal(repeatVerdict(t2, [g2]).hit, null)
})

test('same source back the next day after a closed fix IS a repeat', () => {
  const a = ev('a', 0, { source: 'glitch', part: 'drain_leak', closedDay: 0.2 })
  const b = ev('b', 1, { source: 'glitch', part: 'drain_leak' })
  assert.equal(repeatVerdict(b, [a]).hit, 'a')
})

test('cleaning and other never repeat', () => {
  for (const system of ['cleaning', 'other']) {
    const a = ev('a', 0, { system, closedDay: 1 })
    const b = ev('b', 5, { system })
    const v = repeatVerdict(b, [a])
    assert.equal(v.hit, null, system)
    assert.equal(v.loose, 1)
  }
})

test('older than 90 days is out of the window entirely', () => {
  const a = ev('a', 0, { part: 'toilet', system: 'plumbing' })
  const b = ev('b', 95, { part: 'toilet', system: 'plumbing' })
  assert.deepEqual(repeatVerdict(b, [a]), { loose: 0, hit: null, why: null })
})

test('the newest qualifying earlier event is the one recorded', () => {
  const a = ev('a', 0, { part: 'toilet', system: 'plumbing' })
  const b = ev('b', 30, { part: 'toilet', system: 'plumbing' })
  const c = ev('c', 60, { part: 'toilet', system: 'plumbing' })
  assert.equal(repeatVerdict(c, [a, b]).hit, 'b')
})

test('part words match on word edges', () => {
  assert.equal(subsystemOf('plumbing', 'Bathroom sink leaking'), 'sink_faucet')
  assert.equal(subsystemOf('plumbing', 'bath tub drain slow'), 'shower_tub')
  assert.equal(subsystemOf('appliance', 'strange smell from dishwasher'), 'dishwasher')
  assert.equal(subsystemOf('appliance', 'oven range not lighting'), 'oven_stove')
  assert.equal(subsystemOf('furniture', 'unstable shelf in closet'), 'cabinet')
  assert.equal(subsystemOf('furniture', 'dining table wobbly'), 'seating')
  assert.equal(subsystemOf('furniture', 'Oasis 2nd floor - blinds broken'), 'blinds')
  assert.equal(subsystemOf('furniture', 'sofa bed mattress torn'), 'sofa')
  assert.equal(subsystemOf('lock_access', 'please handle the lockbox'), 'key')
  assert.equal(subsystemOf('hvac', 'japan style unit, condensate overflow'), 'drain_leak')
  assert.equal(subsystemOf('hvac', 'AC check'), null)
  assert.equal(subsystemOf('other', 'anything'), null)
})

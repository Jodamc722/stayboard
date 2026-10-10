// node lib/__tests__/unit-keep.test.mjs — ROOM NUMBERS SURVIVE THE CODE SCRUB (Jon, 2026-10-10: "share
// room numbers etc. when sharing details"). "the door lock at Botanica [redacted] is broken" named the
// one thing the room needed and masked it. Door codes still go.
const R = await import('../eve/redact.ts')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (x ? '  ' + x : '')) } }
const scrub = (t) => R.scrubStoredText(t, [], undefined, { room: true, keep: R.UNIT_KEEP_RE })
console.log('\nunit numbers kept, codes masked')
for (const [t, keep] of [
  ['Miles called to inform Victoria that the door lock at Botanica 2205 is broken', 'Botanica 2205'],
  ['Arya 1705 — door code not working', 'Arya 1705'],
  ['Smart lock offline — Eden 1205', 'Eden 1205'],
  ['17WEST - 516 - 3BR hot water, lock sticks', '17WEST - 516'],
  ['The gate fob for Elser 2201 is dead', 'Elser 2201'],
  ['Park Towers 208 keypad battery', 'Park Towers 208'],
  ['Lockbox at Arya 1002/1 needs a new code', 'Arya 1002/1'],
]) { const out = scrub(t); ok('keeps ' + keep, out.includes(keep), out) }
for (const [t, gone] of [
  ['door code for unit 1102 is 4821', '4821'],
  ['Front door 4821 then gate 9911', '4821'],
  ['Botanica 2205 lock code is 7731', '7731'],
]) { const out = scrub(t); ok('masks ' + gone, !out.includes(gone), out) }
ok('the unit next to a masked code survives', scrub('Botanica 2205 lock code is 7731').includes('Botanica 2205'))
console.log(`  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

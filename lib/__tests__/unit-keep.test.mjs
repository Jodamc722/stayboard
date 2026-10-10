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

// From #vr-eve, Oct 9–10 (independent study): what actually went out, and what must go out now.
console.log('\nroom references after the lock word (independent study 2026-10-10)')
{
  const t = 'Unit 514 and 505 door codes not working (514, 505) — #17West HK'
  ok('rooms named before the lock word are kept after it', scrub(t) === t, scrub(t))
  const a = scrub('Smart lock offline — Eden 1205; the door code for Arya 1705 is 4821')
  ok('kept unit inside the door-code window', a.includes('Arya 1705') && !a.includes('4821'), a)
  const b = scrub('Use 4821 at the gate. The door code is 4821')
  ok('a code masked earlier cannot vouch for its later copy', !b.includes('4821'), b)
  const c = scrub('door code 4821, again 4821 if it fails')
  ok('a code repeated after its word is masked both times', !c.includes('4821'), c)
  const d = scrub('AC not working in 409 (guest: Nomad) (409) — #Miami HK')
  ok('no lock word, nothing touched', d === 'AC not working in 409 (guest: Nomad) (409) — #Miami HK', d)
  const e = scrub('gate code 5566 — see #17West maint')
  ok('a channel name glued to digits is not a code; the code is', e.includes('#17West') && !e.includes('5566'), e)
}
console.log(`  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

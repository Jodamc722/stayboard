// node lib/eve/__tests__/redact.test.mjs
//
// Self-test for lib/eve/redact.ts — the one place door codes are stripped from Eve's tool results.
// Plain node, no build, no deps: node >= 22.18 strips the TypeScript types itself, and redact.ts has
// no imports on purpose so it can be loaded like this.
//
// The first three cases are the leaks the 2026-09-28 audit proved against the compiled redactor
// (04-eve.md F1). They must stay redacted; a confirmation code must never be.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const R = await import('../redact.ts')
const { redactSensitive, REDACTED, looksLikeDoorCode, DOOR_CODE_FIELD_ID } = R

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')) } }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
const leaks = (name, out, code) => ok(name, !JSON.stringify(out).includes(code), `still contains ${code}: ${JSON.stringify(out)}`)

// ── the id in redact.ts is the id code-integrity.ts uses ────────────────────────────────────────
{
  const src = readFileSync(join(here, '..', 'code-integrity.ts'), 'utf8')
  const m = src.match(/export const DOOR_CODE_FIELD\s*=\s*'([0-9a-f]+)'/)
  ok('code-integrity DOOR_CODE_FIELD is readable', !!m)
  ok('redact DOOR_CODE_FIELD_ID matches code-integrity DOOR_CODE_FIELD', m && m[1] === DOOR_CODE_FIELD_ID, m ? `${m[1]} vs ${DOOR_CODE_FIELD_ID}` : '')
}

console.log('\nthe three leaks from the audit')
{
  const a = redactSensitive({ field: 'Door Code', field_id: '695af1454ebbdc00137c3f41', filled_on_units: 180, coverage_pct: 77, example: '4821#' })
  leaks('1. guesty_fields row: example beside a code field', a, '4821')
  eq('1. …but the name, id and counts survive', { field: a.field, field_id: a.field_id, filled_on_units: a.filled_on_units, coverage_pct: a.coverage_pct }, { field: 'Door Code', field_id: '695af1454ebbdc00137c3f41', filled_on_units: 180, coverage_pct: 77 })
  eq('1. …and the example says why it is gone', a.example, REDACTED)

  const b = redactSensitive({ fields: [{ field: 'Door Code', value: '4821#' }] })
  leaks('2. {field, value} rows', b, '4821')
  eq('2. …name kept', b.fields[0].field, 'Door Code')

  const c = redactSensitive([{ name: 'Salto code', value: '739201' }, { name: 'Lockbox', value: '2468' }])
  leaks('3. Salto code by name', c, '739201')
  leaks('3. Lockbox by name', c, '2468')
  eq('3. names kept', c.map(x => x.name), ['Salto code', 'Lockbox'])
}

console.log('\nfield names')
for (const name of ['Door code', 'Keypad', 'Gate code', 'Garage pin', 'Smart lock', 'Smart Lock Code', 'Passcode', 'Combination', 'PIN', 'Lock box', 'Código de la puerta', 'Code'])
  leaks('code field by name: ' + name, redactSensitive({ name, value: '5512' }), '5512')
for (const name of ['Doorman', 'Outdoor space', 'Entry instructions', 'Guest order form', 'Parking spot', 'Country', 'Bedrooms', 'Pinned note'])
  eq('not a code field: ' + name, redactSensitive({ name, value: 'Spot 12, level 3' }), { name, value: 'Spot 12, level 3' })
eq('a label that mentions a door code is not a field (agent-mode action list)',
  redactSensitive({ key: 'door_code_release', label: 'Release a door code', what: 'Hand a code to a person.', def: 2, cap: 2 }),
  { key: 'door_code_release', label: 'Release a door code', what: 'Hand a code to a person.', def: 2, cap: 2 })

for (const slug of ['door_code', 'gate_code', 'lock_box', 'smart_lock', 'res_code_salto']) ok('code field name (slug): ' + slug, R.isCodeFieldName(slug) === true)
for (const slug of ['guest_order_form1', 'welcome_call', 'parking']) ok('not a code field name: ' + slug, R.isCodeFieldName(slug) === false)

console.log('\nraw Guesty shapes')
leaks('{fieldId: DOOR_CODE, value}', redactSensitive({ customFields: [{ fieldId: DOOR_CODE_FIELD_ID, value: '4821' }] }), '4821')
leaks('{fieldId: {_id, name}, value}', redactSensitive({ customFields: [{ fieldId: { _id: 'abc', name: 'Door code' }, value: '4821' }] }), '4821')
leaks('reservation per-stay field', redactSensitive({ customFields: [{ fieldId: '693adec2ab73940025856e56', value: '7777' }] }), '7777')
leaks('an unnamed field id learned from the definitions', redactSensitive({ customFields: [{ fieldId: 'aaaabbbbccccddddeeee0000', value: '3141' }] }, { codeFieldIds: ['aaaabbbbccccddddeeee0000'] }), '3141')
eq('…and without that id it is just a field', redactSensitive({ customFields: [{ fieldId: 'aaaabbbbccccddddeeee0000', value: 'Level 3' }] }), { customFields: [{ fieldId: 'aaaabbbbccccddddeeee0000', value: 'Level 3' }] })
leaks('keys that name a code', redactSensitive({ door_code: '4821', lockbox: '2468', passcode: '9911', pin: '1357', salto_code: '739201' }), '4821')

console.log('\nfree text')
const TEXT_LEAKS = [
  ['door code 1234', '1234'], ['keypad code: 5678#', '5678'], ['lock code is 4321', '4321'], ['Gate code 9090', '9090'],
  ['use code 4821', '4821'], ['Code: 4821#', '4821'], ['the code is 4821', '4821'], ['lockbox 4821', '4821'],
  ['Lockbox: 2468 on the left rail', '2468'], ['pin 4821', '4821'], ['PIN #7788', '7788'], ['Salto 739201', '739201'],
  ['salto code 739201', '739201'], ['passcode: 1234', '1234'], ['combination 5566', '5566'], ['keypad: 5678#', '5678'],
  ['door code for 1102 is 4821', '4821'], ['4821 is the door code', '4821'], ['el código de la puerta es 4821', '4821'],
  ['código 4821', '4821'], ['res code 6655', '6655'], ['reservation code 6655', '6655'],
]
for (const [t, code] of TEXT_LEAKS) leaks('text: ' + t, redactSensitive({ note: t }), code)

const TEXT_SAFE = [
  'confirmation code HMABC123', 'Confirmation code: HMABC123', 'confirmationCode HM4TZ9QX2P',
  'Booking.com confirmation code: 4123456789', 'Your booking code is 55512', 'zip code 33139', 'area code 305',
  'status code 404', 'error code 500', 'Guest 1102 checks out at 11', 'Keypad battery replaced — 1102', 'Salto battery low in 402',
  'Unit 1102 is ready', 'Call 305-555-1234', 'promo code 2024', 'Lockbox is on the gate', 'reservation HMABC123 in 1102',
]
for (const t of TEXT_SAFE) eq('left alone: ' + t, redactSensitive({ note: t }), { note: t })
eq('a confirmationCode KEY is not a code key', redactSensitive({ confirmationCode: 'HMABC123', confirmation_code: '4123456789' }), { confirmationCode: 'HMABC123', confirmation_code: '4123456789' })

console.log('\nlooksLikeDoorCode (saveMemory refuses these)')
for (const t of ['Door code for 402 is 4821', 'lockbox 2468 at Salato', 'The code is 4821#']) ok('code-shaped: ' + t, looksLikeDoorCode(t) === true)
for (const t of ['Salato door codes change at the end of every clean', 'Confirmation code HMABC123 belongs to the Rivera stay', 'Unit 1102 has a keypad']) ok('not code-shaped: ' + t, looksLikeDoorCode(t) === false)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

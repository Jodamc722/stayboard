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
const { redactSensitive, REDACTED, looksLikeDoorCode, DOOR_CODE_FIELD_ID, scrubReleasedCodes, RELEASED_CODE_MARK,
  maskMoneyText, maskMoneyStrings, redactGuestPII, GUEST_HIDDEN } = R

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

console.log('\na code word near a 4-8 digit number is never a memory (2026-09-29, N5)')
{
  const { codeNearDigits } = R
  for (const t of ['The code for 402 is 4821', "402's code is 4821", 'code for unit 402: 4821', '402 code 4821',
    'the gate at Salato opens with 4821', 'use 4821# at the front door', 'Front door at Elser: 4821#',
    'Remember: 1102 entry is 5566#', 'The lockbox at Aria has 2468 in it', 'Botanica garage code changed to 7788',
    'Keypad at 17 West is 1234#', 'Door 402 = 4821', 'PIN#7788 for the pool', 'Salto 12345678*', 'combo is 0000 for the gym lock'])
    ok('refused: ' + t, codeNearDigits(t) === true)
  for (const t of ['unit 402 has 2 bedrooms', 'Elser gate closes at 10pm', 'Salato door codes change at the end of every clean',
    'Unit 1102 has a keypad', 'Unit #1102 lock battery replaced', 'Lockbox installed at Aria in 2024', "Botanica's zip code is 33301",
    'Confirmation code HM12345678 belongs to the Rivera stay', 'Call Salto support at 305-555-1234', 'Gate repair quote was $1200',
    'Door codes rotate on 2026-10-01', 'Keypad battery at 100% on the 12th', 'Pool access 9am-10pm', 'Booking code 55512 was refunded'])
    ok('saved: ' + t, codeNearDigits(t) === false)
  ok('too far apart (more than ~24 characters)', codeNearDigits('The lockbox is behind the planter by the side entrance; call 4821 for the desk.') === false)
}

console.log('\nreleased codes in stored text')
eq('both codes replaced, everywhere', scrubReleasedCodes('Try 4821# first. If that fails: 1357. (4821# again)', ['4821#', '1357']), `Try ${RELEASED_CODE_MARK} first. If that fails: ${RELEASED_CODE_MARK}. (${RELEASED_CODE_MARK} again)`)
eq('nothing released, nothing changed', scrubReleasedCodes('No codes here.', []), 'No codes here.')

console.log('\nreleased codes in any spelling, and what is kept or replayed (2026-09-29, N6)')
{
  const { scrubStoredText, scrubReleasedInValue, redactCodeText, maskCodeNearDigits } = R
  const spelled = scrubReleasedCodes('Try 4 8 2 1 # first, or *4821, or 48-21, or 4821#.', ['4821#'])
  leaks('spaces, a leading *, a dash, a trailing #', spelled, '4821')
  ok('…nothing of it left', !/4\D{0,3}8\D{0,3}2\D{0,3}1/.test(spelled), spelled)
  eq('a longer number that contains the digits is not touched', scrubReleasedCodes('Call 305-148-2100 or unit 14821', ['4821']), 'Call 305-148-2100 or unit 14821')
  eq('the text redactor on its own', redactCodeText('door code 7777 for 402'), 'door code [redacted] for [redacted]')
  eq('a lock word next to a number is masked in stored text', maskCodeNearDigits('The code for 402 is 4821'), 'The code for 402 is [redacted]')
  const stored = scrubStoredText('Here you go: 4 8 2 1#. The gate at Salato opens with 5566, and the lockbox code is 2468.', ['4821#'])
  for (const c of ['4821', '5566', '2468']) leaks('stored text: ' + c, stored, c)
  ok('…with the audit-trail pointer for the released one', stored.includes(RELEASED_CODE_MARK), stored)
  for (const t of ['Unit 1102 is ready; the clean finished at 2:40pm.', 'Unit 1102 has a keypad and 2 bedrooms.', 'Occupancy was 82% across 140 units in 2026.'])
    eq('stored text left alone: ' + t, scrubStoredText(t), t)
  const args = scrubReleasedInValue({ action: 'slack_post', payload: { channel: 'C0VREVE', text: 'Maria, the code for 402 is 4821#', to: ['a', '4 8 2 1'] }, summary: 'post 4821 for Maria', usd: 0 }, ['4821#'])
  leaks('a propose_action payload after a release', args, '4821')
  ok('…and the rest of it is intact', args.action === 'slack_post' && args.payload.channel === 'C0VREVE' && args.usd === 0 && args.payload.to[0] === 'a', JSON.stringify(args))
  eq('no release, arguments untouched', scrubReleasedInValue({ a: 'code 4821' }, []), { a: 'code 4821' })
}

console.log('\nmoney in text')
eq('dollar amounts masked', maskMoneyText('Refund $1,250.50 max; deposit is 300 dollars; USD 90; $2k'), 'Refund $[hidden] max; deposit is $[hidden]; $[hidden]; $[hidden]')
eq('counts and percentages kept', maskMoneyText('3 units, 42% occupancy, 1102 ready'), '3 units, 42% occupancy, 1102 ready')
eq('deep', maskMoneyStrings({ a: ['fee $85'], b: { c: 'ok' }, n: 12 }), { a: ['fee $[hidden]'], b: { c: 'ok' }, n: 12 })

console.log('\nguest details in a vendor room')
{
  const out = redactGuestPII({
    inHouse: { guest: 'Maria Lopez', check_in: '2026-09-27', check_out: '2026-09-30' },
    note: 'Maria Lopez: 2026-09-27 -> 2026-09-30.',
    departures: [{ unit: '1102', guest: 'Tom Hanks', nextGuest: '4:00 PM today', status: 'TURNING' }],
    reviews: [{ rating: 2, text: 'Dirty and loud', guest: 'Ann Lee' }],
    contact: { email: 'x@y.com', phone: '3055551234' },
    count: 3,
  })
  eq('in-house guest hidden', out.inHouse.guest, GUEST_HIDDEN)
  ok('name taken out of the note too', !out.note.includes('Maria'), out.note)
  eq('dates kept', out.inHouse.check_in, '2026-09-27')
  eq('departure guest hidden, next-arrival time kept', out.departures[0], { unit: '1102', guest: GUEST_HIDDEN, nextGuest: '4:00 PM today', status: 'TURNING' })
  eq('review text hidden', out.reviews[0].text, GUEST_HIDDEN)
  eq('contact hidden', out.contact, { email: GUEST_HIDDEN, phone: GUEST_HIDDEN })
  eq('counts kept', out.count, 3)
  ok('says it hid something', typeof out._guest_redacted === 'string')
  eq('nothing to hide, nothing added', redactGuestPII({ unit: '1102', status: 'READY' }), { unit: '1102', status: 'READY' })
}

console.log('\ncode field or device field (2026-09-29, N12)')
{
  const same = (o) => eq('keeps its value: ' + JSON.stringify(o), redactSensitive(o), o)
  same({ name: 'Salto locks offline', value: 3 })
  same({ name: 'Smart lock battery', value: '20%' })
  same({ name: 'Lockbox location', value: 'left rail' })
  same({ name: 'Keypad', value: '100%' })
  same({ name: 'Smart lock', value: 'installed 2025-03-01' })
  same({ name: 'Lockbox location', value: 'by unit 1102' })
  same({ name: 'Lockbox', value: 'Call 305-555-1234 if stuck' })
  same({ field: 'Salto locks offline', count: 3 })
  leaks('device field, code-shaped: Keypad 5512', redactSensitive({ name: 'Keypad', value: '5512' }), '5512')
  leaks('device field, code-shaped: Lockbox "2468 on the left rail"', redactSensitive({ name: 'Lockbox', value: '2468 on the left rail' }), '2468')
  leaks('device field, code-shaped: Salto 551#', redactSensitive({ name: 'Salto', value: '551#' }), '551')
  leaks('device field, code-shaped: a number', redactSensitive({ name: 'Smart lock', value: 739201 }), '739201')
  leaks('device field, a value that is only a 3-digit code', redactSensitive({ name: 'Lockbox', value: '246' }), '246')
  leaks('device field, a dial combination', redactSensitive({ name: 'Lock box', value: '12-34-56' }), '34')
  leaks('device field, spaced digits', redactSensitive({ name: 'Keypad', value: '4 8 2 1' }), '4 8 2 1')
  leaks('device field, a letter prefix', redactSensitive({ name: 'Lockbox', value: 'L-2468' }), '2468')
  same({ name: 'Smart lock', value: 'Battery 85%, changed 9/28 at 10:30' })
  eq('a name that SAYS code hides every value, code-shaped or not', redactSensitive({ name: 'Salto code', value: 'ask the desk' }).value, REDACTED)
  eq('Keycode is a code field', redactSensitive({ name: 'Keycode', value: '1234' }).value, REDACTED)
  for (const n of ['Door code', 'Salto code', 'PIN', 'Garage pin', 'Passcode', 'Combination', 'Keycode', 'Código de la puerta', 'Code', 'res_code_salto', 'Smart Lock Code'])
    ok('code field name: ' + n, R.codeFieldNameKind(n) === 'code', String(R.codeFieldNameKind(n)))
  for (const n of ['Keypad', 'Lockbox', 'Lock box', 'Smart lock', 'Salto', 'Door', 'Salto locks offline', 'Smart lock battery', 'Lockbox location'])
    ok('device field name: ' + n, R.codeFieldNameKind(n) === 'device', String(R.codeFieldNameKind(n)))
  for (const n of ['Doorman', 'Promo code', 'Wifi code', 'Parking spot', 'Pinned note'])
    ok('neither: ' + n, R.codeFieldNameKind(n) === null, String(R.codeFieldNameKind(n)))

  eq('device KEYS keep a place', redactSensitive({ lockbox: 'left rail', salto: 'offline', door: 'Front' }), { lockbox: 'left rail', salto: 'offline', door: 'Front' })
  const k = redactSensitive({ door_code: '4821', lockbox: '2468', passcode: '9911', pin: '1357', salto_code: '739201', salto: '5566#', door: 4411 })
  for (const c of ['4821', '2468', '9911', '1357', '739201', '5566', '4411']) leaks('code under a key: ' + c, k, c)

  const DEV = 'dev000000000000000000001'
  eq('a learned DEVICE field id keeps a battery level', redactSensitive({ customFields: [{ fieldId: DEV, value: '20%' }] }, { deviceFieldIds: [DEV] }), { customFields: [{ fieldId: DEV, value: '20%' }] })
  leaks('…and hides a code', redactSensitive({ customFields: [{ fieldId: DEV, value: '8642' }] }, { deviceFieldIds: [DEV] }), '8642')

  for (const [t, code] of [['door code 4821', '4821'], ['code: 4821#', '4821'], ['Salto 1234#', '1234'], ['door code for unit 1102 is 4821', '4821'], ['Door code (unit 1102): 4821#', '4821']])
    leaks('text still caught: ' + t, redactSensitive({ note: t }), code)
  for (const t of ['Unit 1102 code done', 'Salto locks offline: 3', 'Smart lock battery: 20%', 'Lockbox location: left rail'])
    eq('text left alone: ' + t, redactSensitive({ note: t }), { note: t })
  eq('"door code for unit 1102 is 4821": the unit keeps its number', redactSensitive({ note: 'door code for unit 1102 is 4821' }).note, 'door code for unit 1102 is [redacted]')
}

console.log('\nguest names are taken out as whole words (2026-09-29, N10)')
{
  const out = redactGuestPII({
    arrivals: [{ unit: '402', guest: 'Ana' }, { unit: '905', guest: 'José Pérez' }],
    note: 'Management says the Apartment near the canal needs a deep clean; Banana bread left.',
    detail: 'Ana checked out late. ANA left a key. Ana\'s towels are in the hall.',
    other: 'José Pérez asked for towels; Josefina is the cleaner.',
  })
  eq('"Ana" never touches Management / Apartment / Banana / canal', out.note, 'Management says the Apartment near the canal needs a deep clean; Banana bread left.')
  eq('"Ana" as a word is taken out, any case, before a possessive', out.detail, 'the guest checked out late. the guest left a key. the guest\'s towels are in the hall.')
  eq('an accented full name is taken out, a longer name that starts the same is not', out.other, 'the guest asked for towels; Josefina is the cleaner.')
}

console.log('\nmemories kept out of a room an outside company reads (2026-09-29, N3/N4)')
{
  const { isGuestOrPersonMemory } = R
  for (const m of [
    { kind: 'person', scope: 'portfolio', text: 'Opal runs Capri' },
    { kind: 'rule', scope: 'person:jon@stay-hospitality.com', text: 'Short answers, please' },
    { kind: 'rule', scope: 'channel:Airbnb', text: 'Refunds over one night go to Jon' },
    { kind: 'insight', scope: 'unit:123', text: 'The Rivera guests in 402 always ask for early check-in' },
    { kind: 'insight', scope: 'portfolio', text: 'Call the owner at 305-555-1234 before any repair' },
    { kind: 'issue', scope: 'building:Salato', text: 'Front desk contact is desk@salato-example.com' },
    { kind: 'insight', scope: 'portfolio', text: 'El huésped de la 402 pidió toallas extra' },
    { kind: 'insight', scope: 'portfolio', text: 'Late checkouts pile up on Sundays', why: 'guest messages this month' },
  ]) ok('kept out: ' + m.text, isGuestOrPersonMemory(m) === true)
  for (const m of [
    { kind: 'rule', scope: 'building:Salato', text: 'Salato crew starts at 11', why: 'said in chat by roberto@stay-hospitality.com' },
    { kind: 'issue', scope: 'unit:123', text: 'The AC in 402 trips the breaker in August' },
    { kind: 'rule', scope: 'portfolio', text: 'Deep cleans start 2026-10-01 and repeat every 90 days' },
  ]) ok('kept in: ' + m.text, isGuestOrPersonMemory(m) === false)
}

console.log('\na unit\'s custom fields on the FAQ desk (isCodeValue, 2026-09-29)')
{
  const { isCodeValue } = R
  for (const [name, value] of [['Door Code', '4821#'], ['Gate PIN', '5566'], ['Lockbox combo', 'left rail'], ['Keypad', '5512'], ['Lockbox', '2468 on the left rail'], ['Salto', '739201'], ['Código de la puerta', '1234']]) {
    ok(`hidden: ${name} = ${value}`, isCodeValue(name, value) === true)
  }
  for (const [name, value] of [['Smart lock battery', '20%'], ['Lockbox location', 'left rail by the garage'], ['Salto locks offline', 3], ['Parking', 'Garage level 2'], ['Wi-Fi network', 'Stay-1204'], ['Trash day', 'Tuesday']]) {
    ok(`shown: ${name} = ${value}`, isCodeValue(name, value) === false)
  }
}

console.log('\nthis account\'s own code fields, by name and slug (2026-09-29)')
{
  // Real Guesty custom fields on this account that the name patterns did not know — their values went
  // through every tool untouched.
  for (const n of ['17W Back Up code', 'Building code', 'Old code', 'Program code', 'Guest Code', 'Salto Code', 'Door code',
    '17w_back_up_code', 'building_code', 'old_code', 'program_code', 'guest_code', 'buildingCode'])
    eq('code field: ' + n, R.codeFieldNameKind(n), 'code')
  for (const n of ['Booking.com ID', 'Entry Instructions', 'Unit Number', 'Guest order form', 'Promo code', 'Wifi code', 'Wi-Fi code', 'Confirmation code', 'Zip code', 'Currency code', 'Elser Confirmation Number', 'Parking QR'])
    eq('not a code field: ' + n, R.codeFieldNameKind(n), null)
  for (const [shape, code] of [
    [{ customFields: [{ fieldId: 'abc', name: 'Building code', value: '1234' }] }, '1234'],
    [{ fields: [{ field: 'Old code', value: '4821#' }] }, '4821'],
    [{ fields: [{ field: 'Program code', value: '999111' }] }, '999111'],
    [{ 'Building code': '1234' }, '1234'],
    [{ building_code: '5566' }, '5566'],
    [{ guestCode: '7788' }, '7788'],
  ]) leaks('redacted: ' + JSON.stringify(shape), redactSensitive(shape), code)
  eq('a confirmation code key is left alone', redactSensitive({ confirmationCode: 'HMABC123', confirmation_code: '1234567' }), { confirmationCode: 'HMABC123', confirmation_code: '1234567' })
  eq('a currency code key is left alone', redactSensitive({ currency_code: 'USD' }), { currency_code: 'USD' })
}

console.log('\ncodes written the other ways round (2026-09-29)')
{
  for (const [t, code] of [
    ['Use 4821# on the keypad at the lobby', '4821'],
    ['Enter 5566 at the front door', '5566'],
    ['the code is 4 8 2 1', '4 8 2 1'],
    ['pin 12-34-56 please', '12-34-56'],
    ['Use 4821# to enter the building', '4821'],
    ['Here is your code — 5566', '5566'],
    ['Marca 7788 para entrar', '7788'],
  ]) ok('free text: ' + t, !redactSensitive({ text: t }).text.includes(code), redactSensitive({ text: t }).text)
  for (const [t, code] of [
    ['Building entrance: 1234#', '1234'],
    ['Building: 1234# / Unit: 4821#', '4821'],
    ['Building: 1234# / Unit: 4821#', '1234'],
    ['Door: 4821#', '4821'],
    ['Entrada del edificio 5566#', '5566'],
    ['Lobby call box: dial 1102', '1102'],
    ['Lockbox on the rail, combo 2468', '2468'],
    ['door code for the side gate near unit B, use 48213#', '3#'],
  ]) ok('free text: ' + t + ' (' + code + ')', !redactSensitive({ text: t }).text.includes(code), redactSensitive({ text: t }).text)
  for (const t of ['Unit 1102 at the door has a leak', 'Keypad battery — 1102', 'Call 305-555-1234 at the gate', 'Booked 3 nights at the front desk',
    'Guest in 402 at the door', 'Locked out of 1705 at the front door', 'Salato 902 on the door', 'Elser 3705 at the door',
    'Tech arrives 1030 at the gate', 'Arrive after 1500 to enter', 'Pay $150 to enter', 'Call (305) 555 1234 to open the gate',
    'Keypad — 1102', 'Lockbox – 402 needs a new battery', 'In an emergency dial 911', 'dial 305-555-1234 for the front desk',
    'Unit #402 is ready', 'https://example.com/tasks/1234#notes']) {
    eq('left alone: ' + t, redactSensitive({ text: t }).text, t)
  }
  ok('stored text: punch in the digits', !R.scrubStoredText('Punch in 4821 then press the Schlage button').includes('4821'))
  eq('stored text: a lock brand alone is not a code', R.scrubStoredText('The Schlage in 1102 needs batteries'), 'The Schlage in 1102 needs batteries')
  ok('stored text with a mark of its own', R.scrubStoredText('the code 4821 did not work', ['4821'], '[code]').includes('[code]') && !R.scrubStoredText('the code 4821 did not work', ['4821'], '[code]').includes('4821'))
}

console.log('\nevery string in a room (scrubStoredStrings, 2026-09-29)')
{
  const room = R.scrubStoredStrings({ thread: [{ from: 'us', text: 'Front door 4821, gate 9911' }, { from: 'GUEST', text: 'Thanks!' }], unit: 'Arya 1705/2', count: 4821 })
  leaks('front door', room, '4821,')
  leaks('gate', room, '9911')
  eq('other strings untouched', room.thread[1].text, 'Thanks!')
  eq('unit names untouched', room.unit, 'Arya 1705/2')
  eq('numbers untouched', room.count, 4821)
  const keep = /(?<![A-Za-z0-9])(?:Arya\s+1705|17\s+West\s+1704|Elser\s+3705)(?![A-Za-z0-9])/gi
  for (const t of ['Arya 1705 keypad offline', '17 West 1704 lockbox moved', 'Door lock - Elser 3705', 'Access via 1600 Collins Ave'])
    eq('room keeps: ' + t, R.scrubStoredStrings({ t }, { room: true, keep }).t, t)
  for (const [t, code] of [['Parking garage 5566', '5566'], ['Mailbox 2468', '2468'], ['Call box then fob 7788', '7788']])
    leaks('room masks: ' + t, R.scrubStoredStrings({ t }, { room: true, keep }), code)
  ok('a memory may still mention a garage and a number', R.codeNearDigits('Parking garage 5566 is the visitor level') === false)
  ok('a memory about a street address is not a code', R.codeNearDigits('The entrance is at 1600 Collins Ave') === false)
}

console.log('\nkeys named for a code (2026-09-29)')
{
  eq('a count under a code-ish key stays', redactSensitive({ units_with_code: 212, code_fp: 'ab12cd34' }), { units_with_code: 212, code_fp: 'ab12cd34' })
  leaks('a string under building_code goes', redactSensitive({ building_code: '1234' }), '1234')
  leaks('…and inside an array under one', redactSensitive({ building_codes: ['1234', '5678'] }), '1234')
}

console.log('\na unit fact on a screen (isCodeFact, 2026-09-29)')
{
  const { isCodeFact } = R
  for (const [names, value] of [[['Gate'], '5566'], [['Front door'], '4821#'], [['Garage'], '1234'], [['Building entry'], '1234#'], [['Entry'], '7788'],
    [['Lock'], '1234'], [['Mailbox'], '2468'], [['Alarm'], '9911'], [['Entry Instructions'], 'Punch in 4821 then press the button'],
    [['Program code', 'program_code'], 'see the binder'], [['Notes', 'building_code'], '1234']]) {
    ok(`hidden: ${names.join('/')} = ${value}`, isCodeFact(names, value) === true)
  }
  for (const [names, value] of [[['Entry Instructions'], 'Through the lobby, floor 12, unit 1204'], [['Guest order form'], 'https://forms.example/abc'],
    [['Cleaning time'], '3 hours'], [['Garage'], 'Level 2, spot B'], [['Booking.com ID'], '12345678'], [['Unit Number'], '1204'],
    [['Access'], 'Enter through the lobby at 1600 Collins Ave'], [['Gate'], '7am-10pm'], [['Garage'], 'Spot 214']]) {
    ok(`shown: ${names.join('/')} = ${value}`, isCodeFact(names, value) === false)
  }
  for (const [names, value] of [[['Check-in instructions'], 'Building 1234# / Unit 4821#'], [['Parking'], 'Enter the garage with 5566'], [['Entry Instructions'], 'Building 1234 then elevator']]) {
    ok(`hidden: ${names.join('/')} = ${value}`, isCodeFact(names, value) === true)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

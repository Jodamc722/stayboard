// node lib/__tests__/guest-id-match.test.mjs
//
// The name on the ID against the name on the booking (Jon, 2026-10-21: "verifying that it matches
// the reservation name … if photo added but unsure flag to check"), and the deposit read off the
// booking's payments.
const { namesMatch, decideLink, depositFromMoney, depositHoldsFromMoney, guestyVerifiedFlag, nameTokens } = await import('../guest-id-match.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }

// ── names ──
eq('plain match', namesMatch('John Smith', 'John Smith'), true)
eq('ID prints SURNAME FIRST', namesMatch('SMITH JOHN ROBERT', 'John Smith'), true)
eq('middle names on the ID are free', namesMatch('Maria Fernanda Lopez Garcia', 'Maria Lopez Garcia'), true)
eq('accents and apostrophes do not count', namesMatch("PATRICIA O'BRIEN", 'Patricia Ó Brien'), true)
eq('hyphenated first name', namesMatch('Martin Francois-Xavier', 'Martin Francois-Xavier'), true)
eq('booking has a short form of the first name', namesMatch('Alejandro Ceballos', 'Ale Ceballos'), true)
eq('ID has the short form', namesMatch('Pat O Brien', "Patricia O'Brien"), true)
eq('one camera slip in a long surname', namesMatch('Nadezhda Smirnowa', 'Nadezhda Smirnova'), true)
eq('two slips are a different name', namesMatch('Nadezhda Smimova', 'Nadezhda Smirnova'), false)
eq('an ID with only an initial for the first name is not enough', namesMatch('SMITH J', 'John Smith'), false)
eq('a different first name is not the same person', namesMatch('Jane Smith', 'John Smith'), false)
eq('a different surname is not the same person', namesMatch('John Martin', 'John Martinez'), false)
eq('Martinez is not Martin', namesMatch('John Martinez', 'John Martin'), false)
eq('a company booking matches nobody', namesMatch('Robert Jones', 'Bayside Capital Group LLC'), false)
eq('an initial-only booking needs the one real word', namesMatch('Queen Bee', 'Queen. B'), true)
eq('empty ID name never matches', namesMatch('', 'John Smith'), false)
eq('tokens drop honorifics and initials', nameTokens('Mr. J. Robert Smith Jr'), ['robert', 'smith'])

// ── the verdict ──
const good = { isId: true, readable: true, expired: false, face: true, screen: false, nameOnId: 'SMITH JOHN', resembles: 'unsure' }
eq('a readable current ID in the booking name is verified', decideLink(good, 'John Smith', 'John Smith').status, 'verified')
eq('verified carries the read name and match', (() => { const v = decideLink(good, 'John Smith', 'John Smith'); return [v.match, v.nameOnId, v.reasons] })(), ['match', 'SMITH JOHN', []])
eq('wrong name on the ID → check, with the reason', (() => { const v = decideLink({ ...good, nameOnId: 'JANE DOE' }, 'John Smith', 'John Smith'); return [v.status, v.match, v.reasons[0].slice(0, 22)] })(), ['check', 'mismatch', 'name on the ID "JANE D'])
eq('name not read → check', (() => { const v = decideLink({ ...good, nameOnId: null }, 'John Smith', 'John Smith'); return [v.status, v.match] })(), ['check', 'unread'])
eq('unreadable ID → check, never silently verified', decideLink({ ...good, readable: false }, 'John Smith', 'John Smith').status, 'check')
eq('expired ID → check', decideLink({ ...good, expired: true }, 'John Smith', 'John Smith').status, 'check')
eq('selfie does not resemble → check', decideLink({ ...good, resembles: 'no' }, 'John Smith', 'John Smith').status, 'check')
eq('not an ID at all → retake, nothing kept', decideLink({ ...good, isId: false }, 'John Smith', 'John Smith').status, 'retake')
eq('no face in the selfie → retake', decideLink({ ...good, face: false }, 'John Smith', 'John Smith').status, 'retake')
eq('photo of a screen → retake', decideLink({ ...good, screen: true }, 'John Smith', 'John Smith').status, 'retake')
eq('model did not run → check with the typed name compared', (() => { const v = decideLink(null, 'Jane Doe', 'John Smith'); return [v.status, v.match, v.reasons.length] })(), ['check', 'unread', 2])
eq('typed name differs but the ID matches the booking → verified, noted', (() => { const v = decideLink(good, 'Johnny S', 'John Smith'); return [v.status, v.reasons] })(), ['verified', []])
eq('company booking with a person on the ID → check, says a company booked', (() => { const v = decideLink({ ...good, nameOnId: 'Robert Jones' }, 'Robert Jones', 'Bayside Capital Group LLC'); return [v.status, /company booked/.test(v.reasons[0])] })(), ['check', true])

// ── the deposit off the booking ──
const money = { currency: 'USD', payments: [
  { _id: 'p1', amount: 1200, status: 'SUCCEEDED', isAuthorizationHold: false, paidAt: '2026-10-01T10:00:00Z' },
  { _id: 'p2', amount: 350, status: 'SUCCEEDED', isAuthorizationHold: true, createdAt: '2026-10-20T15:00:00Z' },
] }
eq('an authorization hold is the deposit', depositFromMoney(money), { amount: 350, currency: 'USD', status: 'held', at: '2026-10-20T15:00:00Z', ref: 'p2', note: '' })
eq('a stay payment is not a deposit', depositHoldsFromMoney({ payments: [money.payments[0]] }), [])
eq('a cancelled hold reads released', depositFromMoney({ payments: [{ _id: 'p3', amount: 350, status: 'CANCELLED', isAuthorizationHold: true }] }).status, 'released')
eq('a captured hold reads captured', depositFromMoney({ payments: [{ _id: 'p3', amount: 350, status: 'SUCCEEDED', isAuthorizationHold: true, authorizationHoldCaptured: true }] }).status, 'captured')
eq('a payment noted as the security deposit counts', depositFromMoney({ payments: [{ _id: 'p4', amount: 500, status: 'SUCCEEDED', note: 'Security deposit' }] }).amount, 500)
eq('a pending hold is not vouched for', depositFromMoney({ payments: [{ _id: 'p5', amount: 350, status: 'PENDING', isAuthorizationHold: true }] }), null)
eq('a live hold outranks an old released one', depositFromMoney({ payments: [{ _id: 'a', amount: 350, status: 'CANCELLED', isAuthorizationHold: true, createdAt: '2026-10-21' }, { _id: 'b', amount: 350, status: 'SUCCEEDED', isAuthorizationHold: true, createdAt: '2026-10-19' }] }).ref, 'b')
eq('no payments, no deposit', depositFromMoney(null), null)

// ── the Guesty "verified" tick ──
eq('verified field by id', guestyVerifiedFlag([{ fieldId: 'abc', value: true }], 'abc'), true)
eq('verified field false', guestyVerifiedFlag([{ fieldId: 'abc', value: false }], 'abc'), false)
eq('another field, same value, is not it', guestyVerifiedFlag([{ fieldId: 'zzz', value: true }], 'abc'), false)
eq('by name when the entry carries one', guestyVerifiedFlag([{ fieldName: 'Verified', value: 'yes' }], null), true)
eq('no field id known and no name → false', guestyVerifiedFlag([{ fieldId: 'abc', value: true }], null), false)

console.log(`guest-id-match: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
